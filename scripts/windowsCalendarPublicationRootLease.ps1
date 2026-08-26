[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$PublicationRoot
)

$ErrorActionPreference = "Stop"
$utf8WithoutBom = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = $utf8WithoutBom
$OutputEncoding = $utf8WithoutBom

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public static class TossTradingCalendarPublicationRootLease
{
    private const uint FILE_LIST_DIRECTORY = 0x00000001;
    private const uint FILE_READ_ATTRIBUTES = 0x00000080;
    private const uint SYNCHRONIZE = 0x00100000;
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

    [StructLayout(LayoutKind.Sequential)]
    private struct BY_HANDLE_FILE_INFORMATION
    {
        public uint FileAttributes;
        public System.Runtime.InteropServices.ComTypes.FILETIME CreationTime;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastAccessTime;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWriteTime;
        public uint VolumeSerialNumber;
        public uint FileSizeHigh;
        public uint FileSizeLow;
        public uint NumberOfLinks;
        public uint FileIndexHigh;
        public uint FileIndexLow;
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

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetFileInformationByHandle(
        IntPtr file,
        out BY_HANDLE_FILE_INFORMATION fileInformation
    );

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CloseHandle(IntPtr handle);

    public static int Open(string path, out IntPtr handle, out string identity)
    {
        identity = null;
        handle = CreateFileW(
            path,
            FILE_LIST_DIRECTORY | FILE_READ_ATTRIBUTES | SYNCHRONIZE,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            IntPtr.Zero,
            OPEN_EXISTING,
            FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT,
            IntPtr.Zero
        );
        if (handle == INVALID_HANDLE_VALUE) return Marshal.GetLastWin32Error();
        FILE_ATTRIBUTE_TAG_INFO attributes;
        if (!GetFileInformationByHandleEx(
            handle,
            9,
            out attributes,
            (uint)Marshal.SizeOf(typeof(FILE_ATTRIBUTE_TAG_INFO))
        )) return Marshal.GetLastWin32Error();
        if (
            (attributes.FileAttributes & FILE_ATTRIBUTE_DIRECTORY) == 0 ||
            (attributes.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0
        ) return 4390;
        BY_HANDLE_FILE_INFORMATION information;
        if (!GetFileInformationByHandle(handle, out information))
        {
            return Marshal.GetLastWin32Error();
        }
        ulong fileIdentity =
            ((ulong)information.FileIndexHigh << 32) |
            information.FileIndexLow;
        identity = information.VolumeSerialNumber.ToString() + ":" +
            fileIdentity.ToString();
        return 0;
    }

    public static int Close(ref IntPtr handle)
    {
        if (handle == IntPtr.Zero || handle == INVALID_HANDLE_VALUE)
        {
            handle = IntPtr.Zero;
            return 0;
        }
        bool closed = CloseHandle(handle);
        int error = closed ? 0 : Marshal.GetLastWin32Error();
        handle = IntPtr.Zero;
        return error;
    }
}
"@

$publicationRoot = [System.IO.Path]::GetFullPath($PublicationRoot)
$rootHandle = [IntPtr]::Zero
$identity = $null
$sessionError = [TossTradingCalendarPublicationRootLease]::Open(
    $publicationRoot,
    [ref]$rootHandle,
    [ref]$identity
)
try {
    if ($sessionError -eq 0) {
        [Console]::Out.WriteLine("PUBLICATION_ROOT_LEASE_READY:{0}" -f $identity)
        [Console]::Out.Flush()
        if ([Console]::In.ReadLine() -ne "RELEASE") {
            $sessionError = 87
        }
    }
}
finally {
    $closeError = [TossTradingCalendarPublicationRootLease]::Close(
        [ref]$rootHandle
    )
    if ($sessionError -eq 0) { $sessionError = $closeError }
}

if ($sessionError -ne 0) {
    [Console]::Error.WriteLine("PUBLICATION_ROOT_LEASE_ERROR:{0}" -f $sessionError)
    exit 1
}
[Console]::Out.WriteLine("PUBLICATION_ROOT_LEASE_RELEASED")
