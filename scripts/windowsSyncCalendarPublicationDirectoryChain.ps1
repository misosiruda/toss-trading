[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$PublicationRoot,

    [Parameter(Mandatory = $true)]
    [string]$LeafDirectory,

    [Parameter(Mandatory = $true)]
    [string]$InclusiveAncestorDirectory
)

$ErrorActionPreference = "Stop"
$utf8WithoutBom = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = $utf8WithoutBom
$OutputEncoding = $utf8WithoutBom

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class TossTradingCalendarDirectorySync
{
    private const uint GENERIC_WRITE = 0x40000000;
    private const uint FILE_READ_ATTRIBUTES = 0x00000080;
    private const uint FILE_SHARE_READ = 0x00000001;
    private const uint FILE_SHARE_WRITE = 0x00000002;
    private const uint FILE_SHARE_DELETE = 0x00000004;
    private const uint OPEN_EXISTING = 3;
    private const uint FILE_FLAG_OPEN_REPARSE_POINT = 0x00200000;
    private const uint FILE_FLAG_BACKUP_SEMANTICS = 0x02000000;
    private const uint FILE_ATTRIBUTE_DIRECTORY = 0x00000010;
    private const uint FILE_ATTRIBUTE_REPARSE_POINT = 0x00000400;
    private static readonly IntPtr INVALID_HANDLE_VALUE = new IntPtr(-1);

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

    [DllImport("ntdll.dll")]
    private static extern int NtFlushBuffersFileEx(
        IntPtr fileHandle,
        uint flags,
        IntPtr parameters,
        uint parametersSize,
        out IO_STATUS_BLOCK ioStatusBlock
    );

    [DllImport("ntdll.dll")]
    private static extern uint RtlNtStatusToDosError(int status);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetVolumeInformationByHandleW(
        IntPtr file,
        StringBuilder volumeName,
        uint volumeNameSize,
        out uint volumeSerialNumber,
        out uint maximumComponentLength,
        out uint fileSystemFlags,
        StringBuilder fileSystemName,
        uint fileSystemNameSize
    );

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CloseHandle(IntPtr handle);

    public static int SyncDirectory(string path)
    {
        IntPtr handle = CreateFileW(
            path,
            GENERIC_WRITE | FILE_READ_ATTRIBUTES,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            IntPtr.Zero,
            OPEN_EXISTING,
            FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT,
            IntPtr.Zero
        );
        if (handle == INVALID_HANDLE_VALUE) return Marshal.GetLastWin32Error();
        int syncError = 0;
        try
        {
            FILE_ATTRIBUTE_TAG_INFO information;
            bool inspected = GetFileInformationByHandleEx(
                handle,
                9,
                out information,
                (uint)Marshal.SizeOf(typeof(FILE_ATTRIBUTE_TAG_INFO))
            );
            if (!inspected) return Marshal.GetLastWin32Error();
            if (
                (information.FileAttributes & FILE_ATTRIBUTE_DIRECTORY) == 0 ||
                (information.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0
            )
            {
                return 4390;
            }

            StringBuilder volumeName = new StringBuilder(261);
            StringBuilder fileSystemName = new StringBuilder(64);
            uint serialNumber;
            uint maximumComponentLength;
            uint fileSystemFlags;
            bool volumeInspected = GetVolumeInformationByHandleW(
                handle,
                volumeName,
                (uint)volumeName.Capacity,
                out serialNumber,
                out maximumComponentLength,
                out fileSystemFlags,
                fileSystemName,
                (uint)fileSystemName.Capacity
            );
            if (!volumeInspected) return Marshal.GetLastWin32Error();
            if (!IsSupportedFileSystem(fileSystemName.ToString())) return 50;

            IO_STATUS_BLOCK statusBlock;
            int status = NtFlushBuffersFileEx(
                handle,
                0,
                IntPtr.Zero,
                0,
                out statusBlock
            );
            if (status < 0)
            {
                syncError = unchecked((int)RtlNtStatusToDosError(status));
            }
        }
        finally
        {
            if (!CloseHandle(handle) && syncError == 0)
            {
                syncError = Marshal.GetLastWin32Error();
            }
        }
        return syncError;
    }

    private static bool IsSupportedFileSystem(string fileSystemName)
    {
        return
            string.Equals(fileSystemName, "NTFS", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(fileSystemName, "ReFS", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(fileSystemName, "FAT", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(fileSystemName, "FAT32", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(fileSystemName, "exFAT", StringComparison.OrdinalIgnoreCase);
    }
}
"@

$publicationRoot = [System.IO.Path]::GetFullPath($PublicationRoot)
$leafDirectory = [System.IO.Path]::GetFullPath($LeafDirectory)
$ancestorDirectory = [System.IO.Path]::GetFullPath($InclusiveAncestorDirectory)
$rootPrefix = $publicationRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar) +
    [System.IO.Path]::DirectorySeparatorChar

foreach ($path in @($leafDirectory, $ancestorDirectory)) {
    if (
        -not [string]::Equals(
            $path,
            $publicationRoot,
            [StringComparison]::OrdinalIgnoreCase
        ) -and
        -not $path.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)
    ) {
        [Console]::Error.WriteLine("DIRECTORY_SYNC_PATH_ERROR:87")
        exit 1
    }
}

$directoryChain = [System.Collections.Generic.List[string]]::new()
$current = $leafDirectory
while ($true) {
    $directoryChain.Add($current)
    if ([string]::Equals(
        $current,
        $ancestorDirectory,
        [StringComparison]::OrdinalIgnoreCase
    )) {
        break
    }
    $parent = [System.IO.Directory]::GetParent($current)
    if ($null -eq $parent -or [string]::Equals(
        $parent.FullName,
        $current,
        [StringComparison]::OrdinalIgnoreCase
    )) {
        [Console]::Error.WriteLine("DIRECTORY_SYNC_CHAIN_ERROR:87")
        exit 1
    }
    $current = $parent.FullName
}

foreach ($path in $directoryChain) {
    $syncError = [TossTradingCalendarDirectorySync]::SyncDirectory($path)
    if ($syncError -ne 0) {
        [Console]::Error.WriteLine("DIRECTORY_SYNC_ERROR:{0}" -f $syncError)
        exit 1
    }
}

[Console]::Out.WriteLine(
    "DIRECTORY_SYNC_VERIFIED:{0}" -f $directoryChain.Count
)
