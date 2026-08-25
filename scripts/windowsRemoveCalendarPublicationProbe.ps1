[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$PublicationRoot,

    [Parameter(Mandatory = $true)]
    [string]$ProbeRoot
)

$ErrorActionPreference = "Stop"

Add-Type -TypeDefinition @"
using System;
using System.IO;
using System.Runtime.InteropServices;

public static class TossTradingCalendarProbeCleanup
{
    private const uint FILE_READ_ATTRIBUTES = 0x00000080;
    private const uint FILE_SHARE_READ = 0x00000001;
    private const uint FILE_SHARE_WRITE = 0x00000002;
    private const uint OPEN_EXISTING = 3;
    private const uint FILE_FLAG_OPEN_REPARSE_POINT = 0x00200000;
    private const uint FILE_FLAG_BACKUP_SEMANTICS = 0x02000000;
    private const uint FILE_ATTRIBUTE_DIRECTORY = 0x00000010;
    private const uint FILE_ATTRIBUTE_REPARSE_POINT = 0x00000400;
    private static readonly IntPtr INVALID_HANDLE_VALUE = new IntPtr(-1);

    [StructLayout(LayoutKind.Sequential)]
    private struct FILE_ATTRIBUTE_TAG_INFO
    {
        public uint FileAttributes;
        public uint ReparseTag;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateFileW(
        string fileName,
        uint desiredAccess,
        uint shareMode,
        IntPtr securityAttributes,
        uint creationDisposition,
        uint flagsAndAttributes,
        IntPtr templateFile
    );

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetFileInformationByHandleEx(
        IntPtr file,
        int fileInformationClass,
        out FILE_ATTRIBUTE_TAG_INFO fileInformation,
        uint bufferSize
    );

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool DeleteFileW(string fileName);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool RemoveDirectoryW(string pathName);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CloseHandle(IntPtr handle);

    public static int Cleanup(string probeRoot)
    {
        IntPtr rootHandle;
        int rootOpenError = OpenOwnedDirectory(probeRoot, out rootHandle);
        if (rootOpenError != 0) return rootOpenError;
        try
        {
            string[] rootFiles = {
                "fresh-file.staging",
                "fresh-file.published",
                "collision-file.staging"
            };
            foreach (string fileName in rootFiles)
            {
                int deleteError = DeleteFileIfPresent(Path.Combine(probeRoot, fileName));
                if (deleteError != 0) return deleteError;
            }

            int cleanupError = CleanupNestedDirectory(
                probeRoot,
                "fresh-directory.staging",
                "artifact.json"
            );
            if (cleanupError != 0) return cleanupError;
            cleanupError = CleanupNestedDirectory(
                probeRoot,
                "fresh-directory.published",
                "artifact.json"
            );
            if (cleanupError != 0) return cleanupError;
            cleanupError = CleanupNestedDirectory(
                probeRoot,
                "collision-directory.staging",
                "source-marker.txt"
            );
            if (cleanupError != 0) return cleanupError;
        }
        finally
        {
            CloseHandle(rootHandle);
        }

        return RemoveDirectoryIfPresent(probeRoot);
    }

    private static int CleanupNestedDirectory(
        string probeRoot,
        string directoryName,
        string fileName
    )
    {
        string directoryPath = Path.Combine(probeRoot, directoryName);
        IntPtr directoryHandle;
        int openError = OpenOwnedDirectory(directoryPath, out directoryHandle);
        if (openError == 2 || openError == 3) return 0;
        if (openError != 0) return openError;
        try
        {
            int deleteError = DeleteFileIfPresent(
                Path.Combine(directoryPath, fileName)
            );
            if (deleteError != 0) return deleteError;
        }
        finally
        {
            CloseHandle(directoryHandle);
        }
        return RemoveDirectoryIfPresent(directoryPath);
    }

    private static int OpenOwnedDirectory(string path, out IntPtr handle)
    {
        handle = CreateFileW(
            path,
            FILE_READ_ATTRIBUTES,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            IntPtr.Zero,
            OPEN_EXISTING,
            FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT,
            IntPtr.Zero
        );
        if (handle == INVALID_HANDLE_VALUE)
        {
            return Marshal.GetLastWin32Error();
        }

        FILE_ATTRIBUTE_TAG_INFO information;
        bool inspected = GetFileInformationByHandleEx(
            handle,
            9,
            out information,
            (uint)Marshal.SizeOf(typeof(FILE_ATTRIBUTE_TAG_INFO))
        );
        if (!inspected)
        {
            int error = Marshal.GetLastWin32Error();
            CloseHandle(handle);
            handle = INVALID_HANDLE_VALUE;
            return error;
        }
        if (
            (information.FileAttributes & FILE_ATTRIBUTE_DIRECTORY) == 0 ||
            (information.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0
        )
        {
            CloseHandle(handle);
            handle = INVALID_HANDLE_VALUE;
            return 4390;
        }
        return 0;
    }

    private static int DeleteFileIfPresent(string path)
    {
        if (DeleteFileW(path)) return 0;
        int error = Marshal.GetLastWin32Error();
        return error == 2 || error == 3 ? 0 : error;
    }

    private static int RemoveDirectoryIfPresent(string path)
    {
        if (RemoveDirectoryW(path)) return 0;
        int error = Marshal.GetLastWin32Error();
        return error == 2 || error == 3 ? 0 : error;
    }
}
"@

$publicationRoot = [System.IO.Path]::GetFullPath($PublicationRoot)
$probeRoot = [System.IO.Path]::GetFullPath($ProbeRoot)
$probeParent = [System.IO.Directory]::GetParent($probeRoot)
if (
    $null -eq $probeParent -or
    -not [string]::Equals(
        $probeParent.FullName,
        $publicationRoot,
        [StringComparison]::OrdinalIgnoreCase
    ) -or
    -not [System.IO.Path]::GetFileName($probeRoot).StartsWith(
        ".calendar-publication-preflight-",
        [StringComparison]::Ordinal
    )
) {
    [Console]::Error.WriteLine("PROBE_CLEANUP_ERROR:87")
    exit 1
}

$errorCode = [TossTradingCalendarProbeCleanup]::Cleanup($probeRoot)
if ($errorCode -ne 0) {
    [Console]::Error.WriteLine("PROBE_CLEANUP_ERROR:{0}" -f $errorCode)
    exit 1
}
