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

public static class TossTradingCalendarProbeSession
{
    private const uint FILE_LIST_DIRECTORY = 0x00000001;
    private const uint FILE_READ_ATTRIBUTES = 0x00000080;
    private const uint DELETE = 0x00010000;
    private const uint SYNCHRONIZE = 0x00100000;
    private const uint FILE_SHARE_READ = 0x00000001;
    private const uint FILE_SHARE_WRITE = 0x00000002;
    private const uint FILE_ATTRIBUTE_HIDDEN = 0x00000002;
    private const uint FILE_ATTRIBUTE_DIRECTORY = 0x00000010;
    private const uint FILE_ATTRIBUTE_REPARSE_POINT = 0x00000400;
    private const uint FILE_CREATE = 2;
    private const uint FILE_DIRECTORY_FILE = 0x00000001;
    private const uint FILE_SYNCHRONOUS_IO_NONALERT = 0x00000020;
    private const uint FILE_OPEN_FOR_BACKUP_INTENT = 0x00004000;
    private const uint FILE_OPEN_REPARSE_POINT = 0x00200000;
    private const uint FILE_FLAG_OPEN_REPARSE_POINT = 0x00200000;
    private const uint FILE_FLAG_BACKUP_SEMANTICS = 0x02000000;
    private const uint OPEN_EXISTING = 3;
    private const uint OBJ_CASE_INSENSITIVE = 0x00000040;
    private static readonly IntPtr INVALID_HANDLE_VALUE = new IntPtr(-1);

    [StructLayout(LayoutKind.Sequential)]
    private struct UNICODE_STRING
    {
        public ushort Length;
        public ushort MaximumLength;
        public IntPtr Buffer;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct OBJECT_ATTRIBUTES
    {
        public int Length;
        public IntPtr RootDirectory;
        public IntPtr ObjectName;
        public uint Attributes;
        public IntPtr SecurityDescriptor;
        public IntPtr SecurityQualityOfService;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct IO_STATUS_BLOCK
    {
        public IntPtr Status;
        public UIntPtr Information;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct FILE_ATTRIBUTE_TAG_INFO
    {
        public uint FileAttributes;
        public uint ReparseTag;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct FILE_DISPOSITION_INFO
    {
        [MarshalAs(UnmanagedType.Bool)]
        public bool DeleteFile;
    }

    [DllImport("ntdll.dll")]
    private static extern int NtCreateFile(
        out IntPtr fileHandle,
        uint desiredAccess,
        ref OBJECT_ATTRIBUTES objectAttributes,
        out IO_STATUS_BLOCK ioStatusBlock,
        IntPtr allocationSize,
        uint fileAttributes,
        uint shareAccess,
        uint createDisposition,
        uint createOptions,
        IntPtr eaBuffer,
        uint eaLength
    );

    [DllImport("ntdll.dll")]
    private static extern uint RtlNtStatusToDosError(int status);

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

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetFileInformationByHandle(
        IntPtr file,
        int fileInformationClass,
        ref FILE_DISPOSITION_INFO fileInformation,
        uint bufferSize
    );

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CloseHandle(IntPtr handle);

    public static int CreateOwnedDirectory(string path, out IntPtr handle)
    {
        handle = INVALID_HANDLE_VALUE;
        string ntPath = path.StartsWith(@"\\", StringComparison.Ordinal)
            ? @"\??\UNC\" + path.Substring(2)
            : @"\??\" + path;
        IntPtr stringBuffer = Marshal.StringToHGlobalUni(ntPath);
        IntPtr unicodeStringPointer = IntPtr.Zero;
        try
        {
            UNICODE_STRING unicodeString = new UNICODE_STRING {
                Length = checked((ushort)(ntPath.Length * 2)),
                MaximumLength = checked((ushort)((ntPath.Length + 1) * 2)),
                Buffer = stringBuffer
            };
            unicodeStringPointer = Marshal.AllocHGlobal(
                Marshal.SizeOf(typeof(UNICODE_STRING))
            );
            Marshal.StructureToPtr(unicodeString, unicodeStringPointer, false);
            OBJECT_ATTRIBUTES attributes = new OBJECT_ATTRIBUTES {
                Length = Marshal.SizeOf(typeof(OBJECT_ATTRIBUTES)),
                RootDirectory = IntPtr.Zero,
                ObjectName = unicodeStringPointer,
                Attributes = OBJ_CASE_INSENSITIVE,
                SecurityDescriptor = IntPtr.Zero,
                SecurityQualityOfService = IntPtr.Zero
            };
            IO_STATUS_BLOCK statusBlock;
            int status = NtCreateFile(
                out handle,
                FILE_LIST_DIRECTORY | FILE_READ_ATTRIBUTES | DELETE | SYNCHRONIZE,
                ref attributes,
                out statusBlock,
                IntPtr.Zero,
                FILE_ATTRIBUTE_HIDDEN,
                FILE_SHARE_READ | FILE_SHARE_WRITE,
                FILE_CREATE,
                FILE_DIRECTORY_FILE |
                    FILE_SYNCHRONOUS_IO_NONALERT |
                    FILE_OPEN_FOR_BACKUP_INTENT |
                    FILE_OPEN_REPARSE_POINT,
                IntPtr.Zero,
                0
            );
            if (status < 0)
            {
                handle = INVALID_HANDLE_VALUE;
                return unchecked((int)RtlNtStatusToDosError(status));
            }
            return 0;
        }
        finally
        {
            if (unicodeStringPointer != IntPtr.Zero)
            {
                Marshal.FreeHGlobal(unicodeStringPointer);
            }
            Marshal.FreeHGlobal(stringBuffer);
        }
    }

    public static int Cleanup(string probeRoot, IntPtr rootHandle)
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
        return cleanupError == 0
            ? MarkDirectoryForDeletion(rootHandle)
            : cleanupError;
    }

    public static int CloseOwnedDirectory(IntPtr handle)
    {
        return CloseHandle(handle) ? 0 : Marshal.GetLastWin32Error();
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
        int cleanupError = 0;
        try
        {
            cleanupError = DeleteFileIfPresent(Path.Combine(directoryPath, fileName));
            if (cleanupError == 0)
            {
                cleanupError = MarkDirectoryForDeletion(directoryHandle);
            }
        }
        finally
        {
            int closeError = CloseOwnedDirectory(directoryHandle);
            if (closeError != 0 && cleanupError == 0) cleanupError = closeError;
        }
        return cleanupError;
    }

    private static int OpenOwnedDirectory(string path, out IntPtr handle)
    {
        handle = CreateFileW(
            path,
            FILE_READ_ATTRIBUTES | DELETE,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            IntPtr.Zero,
            OPEN_EXISTING,
            FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT,
            IntPtr.Zero
        );
        if (handle == INVALID_HANDLE_VALUE) return Marshal.GetLastWin32Error();

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
            CloseOwnedDirectory(handle);
            handle = INVALID_HANDLE_VALUE;
            return error;
        }
        if (
            (information.FileAttributes & FILE_ATTRIBUTE_DIRECTORY) == 0 ||
            (information.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0
        )
        {
            CloseOwnedDirectory(handle);
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

    private static int MarkDirectoryForDeletion(IntPtr handle)
    {
        FILE_DISPOSITION_INFO disposition = new FILE_DISPOSITION_INFO {
            DeleteFile = true
        };
        bool marked = SetFileInformationByHandle(
            handle,
            4,
            ref disposition,
            (uint)Marshal.SizeOf(typeof(FILE_DISPOSITION_INFO))
        );
        return marked ? 0 : Marshal.GetLastWin32Error();
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
    [Console]::Error.WriteLine("PROBE_SESSION_ERROR:87")
    exit 1
}

$rootHandle = [IntPtr]::Zero
$createError = [TossTradingCalendarProbeSession]::CreateOwnedDirectory(
    $probeRoot,
    [ref]$rootHandle
)
if ($createError -ne 0) {
    [Console]::Error.WriteLine("PROBE_SESSION_CREATE_ERROR:{0}" -f $createError)
    exit 1
}

$sessionError = 0
try {
    [Console]::Out.WriteLine("PROBE_READY:{0}" -f $probeRoot)
    [Console]::Out.Flush()
    $command = [Console]::In.ReadLine()
    if ($command -ne "CLEANUP") {
        $sessionError = 87
    }
    $cleanupError = [TossTradingCalendarProbeSession]::Cleanup(
        $probeRoot,
        $rootHandle
    )
    if ($cleanupError -ne 0 -and $sessionError -eq 0) {
        $sessionError = $cleanupError
    }
}
finally {
    $closeError = [TossTradingCalendarProbeSession]::CloseOwnedDirectory(
        $rootHandle
    )
    if ($closeError -ne 0 -and $sessionError -eq 0) {
        $sessionError = $closeError
    }
}

if ($sessionError -ne 0) {
    [Console]::Error.WriteLine("PROBE_SESSION_CLEANUP_ERROR:{0}" -f $sessionError)
    exit 1
}
[Console]::Out.WriteLine("PROBE_CLEANUP_VERIFIED")
