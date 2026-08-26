[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$PublicationRoot,

    [Parameter(Mandatory = $true)]
    [string]$PackageNamespace,

    [Parameter(Mandatory = $true)]
    [string]$StagingRoot
)

$ErrorActionPreference = "Stop"
$utf8WithoutBom = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = $utf8WithoutBom
$OutputEncoding = $utf8WithoutBom

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public static class TossTradingCalendarPackageStagingSession
{
    private const uint FILE_LIST_DIRECTORY = 0x00000001;
    private const uint FILE_READ_ATTRIBUTES = 0x00000080;
    private const uint DELETE = 0x00010000;
    private const uint SYNCHRONIZE = 0x00100000;
    private const uint FILE_SHARE_READ = 0x00000001;
    private const uint FILE_SHARE_WRITE = 0x00000002;
    private const uint FILE_SHARE_DELETE = 0x00000004;
    private const uint FILE_ATTRIBUTE_DIRECTORY = 0x00000010;
    private const uint FILE_ATTRIBUTE_REPARSE_POINT = 0x00000400;
    private const uint FILE_OPEN = 1;
    private const uint FILE_CREATE = 2;
    private const uint FILE_DIRECTORY_FILE = 0x00000001;
    private const uint FILE_SYNCHRONOUS_IO_NONALERT = 0x00000020;
    private const uint FILE_NON_DIRECTORY_FILE = 0x00000040;
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

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetFileInformationByHandle(
        IntPtr file,
        out BY_HANDLE_FILE_INFORMATION fileInformation
    );

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

    public static int OpenAbsoluteDirectory(string path, out IntPtr handle)
    {
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
        int inspectError = InspectEntry(handle, true);
        if (inspectError != 0) handle = INVALID_HANDLE_VALUE;
        return inspectError;
    }

    public static int OpenRelativeDirectory(
        IntPtr parentHandle,
        string name,
        out IntPtr handle
    )
    {
        return OpenRelativeEntry(
            parentHandle,
            name,
            true,
            FILE_OPEN,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            out handle
        );
    }

    public static int CreateRelativeDirectory(
        IntPtr parentHandle,
        string name,
        out IntPtr handle
    )
    {
        return OpenRelativeEntry(
            parentHandle,
            name,
            true,
            FILE_CREATE,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            out handle
        );
    }

    public static int CreateMovableRelativeDirectory(
        IntPtr parentHandle,
        string name,
        out IntPtr handle
    )
    {
        return OpenRelativeEntryWithAccess(
            parentHandle,
            name,
            true,
            FILE_CREATE,
            FILE_LIST_DIRECTORY | FILE_READ_ATTRIBUTES | SYNCHRONIZE,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            out handle
        );
    }

    public static int ReleaseForPublish(
        ref IntPtr sourcesHandle,
        ref IntPtr hashesHandle
    )
    {
        int error = CloseOwned(ref hashesHandle);
        int closeError = CloseOwned(ref sourcesHandle);
        if (error == 0) error = closeError;
        return error;
    }

    public static int VerifyPublishedIdentityAndClose(
        IntPtr namespaceHandle,
        string destinationName,
        ref IntPtr stagingHandle
    )
    {
        if (!IsValidHandle(stagingHandle)) return 6;
        IntPtr destinationHandle;
        int openError = OpenRelativeEntry(
            namespaceHandle,
            destinationName,
            true,
            FILE_OPEN,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            out destinationHandle
        );
        if (openError != 0) return openError;
        int error = 0;
        try
        {
            BY_HANDLE_FILE_INFORMATION stagingInformation;
            BY_HANDLE_FILE_INFORMATION destinationInformation;
            if (!GetFileInformationByHandle(stagingHandle, out stagingInformation))
            {
                error = Marshal.GetLastWin32Error();
            }
            else if (!GetFileInformationByHandle(
                destinationHandle,
                out destinationInformation
            ))
            {
                error = Marshal.GetLastWin32Error();
            }
            else if (
                !HasSameIdentity(stagingInformation, destinationInformation)
            )
            {
                error = 1168;
            }
        }
        finally
        {
            int closeError = CloseOwned(ref destinationHandle);
            if (error == 0) error = closeError;
            closeError = CloseOwned(ref stagingHandle);
            if (error == 0) error = closeError;
        }
        return error;
    }

    public static int VerifyRelativeDirectoryIdentity(
        IntPtr parentHandle,
        string name,
        ref IntPtr retainedHandle
    )
    {
        if (!IsValidHandle(retainedHandle)) return 6;
        IntPtr pathHandle;
        int openError = OpenRelativeEntry(
            parentHandle,
            name,
            true,
            FILE_OPEN,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            out pathHandle
        );
        if (openError != 0) return openError;
        int error = 0;
        try
        {
            BY_HANDLE_FILE_INFORMATION retainedInformation;
            BY_HANDLE_FILE_INFORMATION pathInformation;
            if (!GetFileInformationByHandle(retainedHandle, out retainedInformation))
            {
                error = Marshal.GetLastWin32Error();
            }
            else if (!GetFileInformationByHandle(pathHandle, out pathInformation))
            {
                error = Marshal.GetLastWin32Error();
            }
            else if (!HasSameIdentity(retainedInformation, pathInformation))
            {
                error = 1168;
            }
        }
        finally
        {
            if (error == 0)
            {
                int retainedCloseError = CloseOwned(ref retainedHandle);
                if (retainedCloseError == 0)
                {
                    retainedHandle = pathHandle;
                    pathHandle = IntPtr.Zero;
                }
                else
                {
                    error = retainedCloseError;
                }
            }
            int closeError = CloseOwned(ref pathHandle);
            if (error == 0) error = closeError;
        }
        return error;
    }

    public static int ReleaseAll(
        ref IntPtr stagingHandle,
        ref IntPtr sourcesHandle,
        ref IntPtr hashesHandle
    )
    {
        int error = CloseOwned(ref hashesHandle);
        int closeError = CloseOwned(ref sourcesHandle);
        if (error == 0) error = closeError;
        closeError = CloseOwned(ref stagingHandle);
        if (error == 0) error = closeError;
        return error;
    }

    public static int CleanupAndClose(
        ref IntPtr stagingHandle,
        ref IntPtr sourcesHandle,
        ref IntPtr hashesHandle,
        string[] sourceFileNames
    )
    {
        int error = 0;
        if (IsValidHandle(hashesHandle))
        {
            foreach (string sourceFileName in sourceFileNames)
            {
                error = DeleteFileIfPresent(hashesHandle, sourceFileName);
                if (error != 0) break;
            }
            if (error == 0) error = MarkForDeletion(hashesHandle);
        }
        int closeError = CloseOwned(ref hashesHandle);
        if (error == 0) error = closeError;

        if (IsValidHandle(sourcesHandle) && error == 0)
        {
            error = MarkForDeletion(sourcesHandle);
        }
        closeError = CloseOwned(ref sourcesHandle);
        if (error == 0) error = closeError;

        if (IsValidHandle(stagingHandle) && error == 0)
        {
            error = DeleteFileIfPresent(stagingHandle, "artifact.json");
            if (error == 0) error = MarkForDeletion(stagingHandle);
        }
        closeError = CloseOwned(ref stagingHandle);
        if (error == 0) error = closeError;
        return error;
    }

    public static int CloseOwned(ref IntPtr handle)
    {
        if (!IsValidHandle(handle))
        {
            handle = IntPtr.Zero;
            return 0;
        }
        bool closed = CloseHandle(handle);
        int error = closed ? 0 : Marshal.GetLastWin32Error();
        handle = IntPtr.Zero;
        return error;
    }

    private static int OpenRelativeEntry(
        IntPtr parentHandle,
        string name,
        bool expectDirectory,
        uint disposition,
        uint shareAccess,
        out IntPtr handle
    )
    {
        return OpenRelativeEntryWithAccess(
            parentHandle,
            name,
            expectDirectory,
            disposition,
            FILE_LIST_DIRECTORY | FILE_READ_ATTRIBUTES | DELETE | SYNCHRONIZE,
            shareAccess,
            out handle
        );
    }

    private static int OpenRelativeEntryWithAccess(
        IntPtr parentHandle,
        string name,
        bool expectDirectory,
        uint disposition,
        uint desiredAccess,
        uint shareAccess,
        out IntPtr handle
    )
    {
        handle = INVALID_HANDLE_VALUE;
        if (!IsSingleComponent(name)) return 87;
        IntPtr stringBuffer = Marshal.StringToHGlobalUni(name);
        IntPtr unicodeStringPointer = IntPtr.Zero;
        try
        {
            UNICODE_STRING unicodeString = new UNICODE_STRING {
                Length = checked((ushort)(name.Length * 2)),
                MaximumLength = checked((ushort)((name.Length + 1) * 2)),
                Buffer = stringBuffer
            };
            unicodeStringPointer = Marshal.AllocHGlobal(
                Marshal.SizeOf(typeof(UNICODE_STRING))
            );
            Marshal.StructureToPtr(unicodeString, unicodeStringPointer, false);
            OBJECT_ATTRIBUTES attributes = new OBJECT_ATTRIBUTES {
                Length = Marshal.SizeOf(typeof(OBJECT_ATTRIBUTES)),
                RootDirectory = parentHandle,
                ObjectName = unicodeStringPointer,
                Attributes = OBJ_CASE_INSENSITIVE,
                SecurityDescriptor = IntPtr.Zero,
                SecurityQualityOfService = IntPtr.Zero
            };
            IO_STATUS_BLOCK statusBlock;
            int status = NtCreateFile(
                out handle,
                desiredAccess,
                ref attributes,
                out statusBlock,
                IntPtr.Zero,
                0,
                shareAccess,
                disposition,
                (expectDirectory ? FILE_DIRECTORY_FILE : FILE_NON_DIRECTORY_FILE) |
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
            int inspectError = InspectEntry(handle, expectDirectory);
            if (inspectError != 0) handle = INVALID_HANDLE_VALUE;
            return inspectError;
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

    private static int OpenRelativeFile(
        IntPtr parentHandle,
        string name,
        out IntPtr handle
    )
    {
        return OpenRelativeEntry(
            parentHandle,
            name,
            false,
            FILE_OPEN,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            out handle
        );
    }

    private static int InspectEntry(IntPtr handle, bool expectDirectory)
    {
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
            return error;
        }
        bool isDirectory =
            (information.FileAttributes & FILE_ATTRIBUTE_DIRECTORY) != 0;
        if (
            isDirectory != expectDirectory ||
            (information.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0
        )
        {
            CloseHandle(handle);
            return 4390;
        }
        return 0;
    }

    private static int DeleteFileIfPresent(IntPtr parentHandle, string name)
    {
        IntPtr fileHandle;
        int openError = OpenRelativeFile(parentHandle, name, out fileHandle);
        if (openError == 2 || openError == 3) return 0;
        if (openError != 0) return openError;
        int error = MarkForDeletion(fileHandle);
        int closeError = CloseOwned(ref fileHandle);
        return error == 0 ? closeError : error;
    }

    private static int MarkForDeletion(IntPtr handle)
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

    private static bool IsSingleComponent(string name)
    {
        return
            !String.IsNullOrEmpty(name) &&
            name != "." &&
            name != ".." &&
            name.IndexOfAny(new char[] { '\\', '/' }) < 0;
    }

    private static bool HasSameIdentity(
        BY_HANDLE_FILE_INFORMATION left,
        BY_HANDLE_FILE_INFORMATION right
    )
    {
        return
            left.VolumeSerialNumber == right.VolumeSerialNumber &&
            left.FileIndexHigh == right.FileIndexHigh &&
            left.FileIndexLow == right.FileIndexLow;
    }

    private static bool IsValidHandle(IntPtr handle)
    {
        return handle != IntPtr.Zero && handle != INVALID_HANDLE_VALUE;
    }
}
"@

function Read-CanonicalSourceFileNames {
    $sourceFileNames = [System.Collections.Generic.List[string]]::new()
    while ($true) {
        $line = [Console]::In.ReadLine()
        if ($null -eq $line) {
            throw "source file list ended before END"
        }
        if ($line -eq "END") {
            return $sourceFileNames.ToArray()
        }
        if (
            $line -cnotmatch '^[a-f0-9]{64}\.bin$' -or
            ($sourceFileNames.Count -gt 0 -and
                [string]::CompareOrdinal(
                    $sourceFileNames[$sourceFileNames.Count - 1],
                    $line
                ) -ge 0)
        ) {
            throw "source file list is not canonical"
        }
        $sourceFileNames.Add($line)
    }
}

$publicationRoot = [System.IO.Path]::GetFullPath($PublicationRoot)
$packageNamespace = [System.IO.Path]::GetFullPath($PackageNamespace)
$stagingRoot = [System.IO.Path]::GetFullPath($StagingRoot)
$namespaceParent = [System.IO.Directory]::GetParent($packageNamespace)
$stagingParent = [System.IO.Directory]::GetParent($stagingRoot)
$stagingName = [System.IO.Path]::GetFileName($stagingRoot)
$stagingNamePattern = '^\.calendar-package-(?<artifact>[a-f0-9]{64})-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.staging$'
if (
    $null -eq $namespaceParent -or
    $null -eq $stagingParent -or
    -not [string]::Equals(
        $namespaceParent.FullName,
        $publicationRoot,
        [StringComparison]::OrdinalIgnoreCase
    ) -or
    -not [string]::Equals(
        [System.IO.Path]::GetFileName($packageNamespace),
        "sha256",
        [StringComparison]::Ordinal
    ) -or
    -not [string]::Equals(
        $stagingParent.FullName,
        $packageNamespace,
        [StringComparison]::OrdinalIgnoreCase
    ) -or
    $stagingName -cnotmatch $stagingNamePattern
) {
    [Console]::Error.WriteLine("PACKAGE_STAGING_ERROR:87")
    exit 1
}
$artifactHex = [regex]::Match(
    $stagingName,
    $stagingNamePattern
).Groups['artifact'].Value

$publicationRootHandle = [IntPtr]::Zero
$namespaceHandle = [IntPtr]::Zero
$stagingHandle = [IntPtr]::Zero
$sourcesHandle = [IntPtr]::Zero
$hashesHandle = [IntPtr]::Zero
$sessionError = 0
$preservePackageOnError = $false
try {
    $sessionError = [TossTradingCalendarPackageStagingSession]::OpenAbsoluteDirectory(
        $publicationRoot,
        [ref]$publicationRootHandle
    )
    if ($sessionError -eq 0) {
        $sessionError = [TossTradingCalendarPackageStagingSession]::OpenRelativeDirectory(
            $publicationRootHandle,
            "sha256",
            [ref]$namespaceHandle
        )
    }
    if ($sessionError -eq 0) {
        $sessionError = [TossTradingCalendarPackageStagingSession]::CreateMovableRelativeDirectory(
            $namespaceHandle,
            $stagingName,
            [ref]$stagingHandle
        )
    }
    if ($sessionError -eq 0) {
        $sessionError = [TossTradingCalendarPackageStagingSession]::CreateRelativeDirectory(
            $stagingHandle,
            "sources",
            [ref]$sourcesHandle
        )
    }
    if ($sessionError -eq 0) {
        $sessionError = [TossTradingCalendarPackageStagingSession]::CreateRelativeDirectory(
            $sourcesHandle,
            "sha256",
            [ref]$hashesHandle
        )
    }
    if ($sessionError -eq 0) {
        [Console]::Out.WriteLine("PACKAGE_STAGING_READY:{0}" -f $stagingRoot)
        [Console]::Out.Flush()
        $command = [Console]::In.ReadLine()
        if ($command -eq "RELEASE") {
            $sessionError = [TossTradingCalendarPackageStagingSession]::ReleaseForPublish(
                [ref]$sourcesHandle,
                [ref]$hashesHandle
            )
            if ($sessionError -eq 0) {
                [Console]::Out.WriteLine("PACKAGE_STAGING_RELEASED")
                [Console]::Out.Flush()
                $completionCommand = [Console]::In.ReadLine()
                if ($completionCommand -eq "DONE") {
                    $preservePackageOnError = $true
                    $sessionError = [TossTradingCalendarPackageStagingSession]::VerifyPublishedIdentityAndClose(
                        $namespaceHandle,
                        $artifactHex,
                        [ref]$stagingHandle
                    )
                    if ($sessionError -eq 0) {
                        [Console]::Out.WriteLine("PACKAGE_STAGING_COMPLETED")
                    }
                }
                elseif ($completionCommand -eq "CLEANUP") {
                    $preservePackageOnError = $true
                    $sessionError = [TossTradingCalendarPackageStagingSession]::VerifyRelativeDirectoryIdentity(
                        $namespaceHandle,
                        $stagingName,
                        [ref]$stagingHandle
                    )
                    if ($sessionError -eq 0) {
                        $preservePackageOnError = $false
                        $sessionError = [TossTradingCalendarPackageStagingSession]::OpenRelativeDirectory(
                            $stagingHandle,
                            "sources",
                            [ref]$sourcesHandle
                        )
                    }
                    if ($sessionError -eq 0) {
                        $sessionError = [TossTradingCalendarPackageStagingSession]::OpenRelativeDirectory(
                            $sourcesHandle,
                            "sha256",
                            [ref]$hashesHandle
                        )
                    }
                    if ($sessionError -eq 0) {
                        try {
                            $sourceFileNames = Read-CanonicalSourceFileNames
                            $sessionError = [TossTradingCalendarPackageStagingSession]::CleanupAndClose(
                                [ref]$stagingHandle,
                                [ref]$sourcesHandle,
                                [ref]$hashesHandle,
                                $sourceFileNames
                            )
                        }
                        catch {
                            $sessionError = 87
                        }
                    }
                    if ($sessionError -eq 0) {
                        [Console]::Out.WriteLine("PACKAGE_STAGING_CLEANUP_VERIFIED")
                    }
                }
                else {
                    $sessionError = 87
                }
            }
        }
        elseif ($command -eq "CLEANUP") {
            $preservePackageOnError = $true
            $sessionError = [TossTradingCalendarPackageStagingSession]::VerifyRelativeDirectoryIdentity(
                $namespaceHandle,
                $stagingName,
                [ref]$stagingHandle
            )
            if ($sessionError -eq 0) {
                $preservePackageOnError = $false
                try {
                    $sourceFileNames = Read-CanonicalSourceFileNames
                    $sessionError = [TossTradingCalendarPackageStagingSession]::CleanupAndClose(
                        [ref]$stagingHandle,
                        [ref]$sourcesHandle,
                        [ref]$hashesHandle,
                        $sourceFileNames
                    )
                }
                catch {
                    $sessionError = 87
                }
                if ($sessionError -eq 0) {
                    [Console]::Out.WriteLine("PACKAGE_STAGING_CLEANUP_VERIFIED")
                }
            }
        }
        else {
            $sessionError = 87
        }
    }
}
finally {
    if (
        $sessionError -ne 0 -and
        -not $preservePackageOnError -and
        $stagingHandle -ne [IntPtr]::Zero
    ) {
        $preservePackageOnError = $true
        $identityError = [TossTradingCalendarPackageStagingSession]::VerifyRelativeDirectoryIdentity(
            $namespaceHandle,
            $stagingName,
            [ref]$stagingHandle
        )
        if ($identityError -eq 0) {
            $preservePackageOnError = $false
            [void][TossTradingCalendarPackageStagingSession]::CleanupAndClose(
                [ref]$stagingHandle,
                [ref]$sourcesHandle,
                [ref]$hashesHandle,
                [string[]]@()
            )
        }
    }
    $closeError = [TossTradingCalendarPackageStagingSession]::ReleaseAll(
        [ref]$stagingHandle,
        [ref]$sourcesHandle,
        [ref]$hashesHandle
    )
    if ($sessionError -eq 0) { $sessionError = $closeError }
    $closeError = [TossTradingCalendarPackageStagingSession]::CloseOwned(
        [ref]$namespaceHandle
    )
    if ($sessionError -eq 0) { $sessionError = $closeError }
    $closeError = [TossTradingCalendarPackageStagingSession]::CloseOwned(
        [ref]$publicationRootHandle
    )
    if ($sessionError -eq 0) { $sessionError = $closeError }
}

if ($sessionError -ne 0) {
    [Console]::Error.WriteLine("PACKAGE_STAGING_ERROR:{0}" -f $sessionError)
    exit 1
}
