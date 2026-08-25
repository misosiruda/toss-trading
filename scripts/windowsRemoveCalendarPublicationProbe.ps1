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
using System.Runtime.InteropServices;

public static class TossTradingCalendarProbeCleanup
{
    private const uint FILE_READ_ATTRIBUTES = 0x00000080;
    private const uint DELETE = 0x00010000;
    private const uint SYNCHRONIZE = 0x00100000;
    private const uint FILE_SHARE_READ = 0x00000001;
    private const uint FILE_SHARE_WRITE = 0x00000002;
    private const uint FILE_OPEN = 1;
    private const uint FILE_DIRECTORY_FILE = 0x00000001;
    private const uint FILE_SYNCHRONOUS_IO_NONALERT = 0x00000020;
    private const uint FILE_NON_DIRECTORY_FILE = 0x00000040;
    private const uint FILE_OPEN_FOR_BACKUP_INTENT = 0x00004000;
    private const uint FILE_OPEN_REPARSE_POINT = 0x00200000;
    private const uint OPEN_EXISTING = 3;
    private const uint FILE_FLAG_OPEN_REPARSE_POINT = 0x00200000;
    private const uint FILE_FLAG_BACKUP_SEMANTICS = 0x02000000;
    private const uint FILE_ATTRIBUTE_DIRECTORY = 0x00000010;
    private const uint FILE_ATTRIBUTE_REPARSE_POINT = 0x00000400;
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
    private static extern bool SetFileInformationByHandle(
        IntPtr file,
        int fileInformationClass,
        ref FILE_DISPOSITION_INFO fileInformation,
        uint bufferSize
    );

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CloseHandle(IntPtr handle);

    public static int Cleanup(string probeRoot)
    {
        IntPtr rootHandle;
        int rootOpenError = OpenOwnedDirectory(probeRoot, out rootHandle);
        if (rootOpenError != 0) return rootOpenError;
        int cleanupError = 0;
        try
        {
            string[] rootFiles = {
                "fresh-file.staging",
                "fresh-file.published",
                "collision-file.staging"
            };
            foreach (string fileName in rootFiles)
            {
                int deleteError = DeleteFileIfPresent(rootHandle, fileName);
                if (deleteError != 0)
                {
                    cleanupError = deleteError;
                    break;
                }
            }

            if (cleanupError == 0)
            {
                cleanupError = CleanupPackageDirectory(
                    rootHandle,
                    "fresh-directory.staging"
                );
            }
            if (cleanupError == 0)
            {
                cleanupError = CleanupPackageDirectory(
                    rootHandle,
                    "fresh-directory.published"
                );
            }
            if (cleanupError == 0)
            {
                cleanupError = CleanupNestedDirectory(
                    rootHandle,
                    "collision-directory.staging",
                    "source-marker.txt"
                );
            }
            if (cleanupError == 0)
            {
                cleanupError = MarkDirectoryForDeletion(rootHandle);
            }
        }
        finally
        {
            if (!CloseHandle(rootHandle) && cleanupError == 0)
            {
                cleanupError = Marshal.GetLastWin32Error();
            }
        }
        return cleanupError;
    }

    private static int CleanupNestedDirectory(
        IntPtr parentHandle,
        string directoryName,
        string fileName
    )
    {
        IntPtr directoryHandle;
        int openError = OpenOwnedDirectoryRelative(
            parentHandle,
            directoryName,
            out directoryHandle
        );
        if (openError == 2 || openError == 3) return 0;
        if (openError != 0) return openError;
        int cleanupError = 0;
        try
        {
            cleanupError = DeleteFileIfPresent(directoryHandle, fileName);
            if (cleanupError == 0)
            {
                cleanupError = MarkDirectoryForDeletion(directoryHandle);
            }
        }
        finally
        {
            if (!CloseHandle(directoryHandle) && cleanupError == 0)
            {
                cleanupError = Marshal.GetLastWin32Error();
            }
        }
        return cleanupError;
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

    private static int CleanupPackageDirectory(
        IntPtr probeRootHandle,
        string directoryName
    )
    {
        IntPtr directoryHandle;
        int openError = OpenOwnedDirectoryRelative(
            probeRootHandle,
            directoryName,
            out directoryHandle
        );
        if (openError == 2 || openError == 3) return 0;
        if (openError != 0) return openError;
        int cleanupError = 0;
        try
        {
            cleanupError = CleanupSourcesDirectory(directoryHandle);
            if (cleanupError == 0)
            {
                cleanupError = DeleteFileIfPresent(directoryHandle, "artifact.json");
            }
            if (cleanupError == 0)
            {
                cleanupError = MarkDirectoryForDeletion(directoryHandle);
            }
        }
        finally
        {
            if (!CloseHandle(directoryHandle) && cleanupError == 0)
            {
                cleanupError = Marshal.GetLastWin32Error();
            }
        }
        return cleanupError;
    }

    private static int CleanupSourcesDirectory(IntPtr packageHandle)
    {
        IntPtr sourcesHandle;
        int openError = OpenOwnedDirectoryRelative(
            packageHandle,
            "sources",
            out sourcesHandle
        );
        if (openError == 2 || openError == 3) return 0;
        if (openError != 0) return openError;
        int cleanupError = 0;
        try
        {
            cleanupError = CleanupNestedDirectory(
                sourcesHandle,
                "sha256",
                "source.bin"
            );
            if (cleanupError == 0)
            {
                cleanupError = MarkDirectoryForDeletion(sourcesHandle);
            }
        }
        finally
        {
            if (!CloseHandle(sourcesHandle) && cleanupError == 0)
            {
                cleanupError = Marshal.GetLastWin32Error();
            }
        }
        return cleanupError;
    }

    private static int OpenOwnedDirectoryRelative(
        IntPtr parentHandle,
        string name,
        out IntPtr handle
    )
    {
        return OpenOwnedEntryRelative(
            parentHandle,
            name,
            true,
            out handle
        );
    }

    private static int OpenOwnedFileRelative(
        IntPtr parentHandle,
        string name,
        out IntPtr handle
    )
    {
        return OpenOwnedEntryRelative(
            parentHandle,
            name,
            false,
            out handle
        );
    }

    private static int OpenOwnedEntryRelative(
        IntPtr parentHandle,
        string name,
        bool expectDirectory,
        out IntPtr handle
    )
    {
        handle = INVALID_HANDLE_VALUE;
        if (
            String.IsNullOrEmpty(name) ||
            name.IndexOfAny(new char[] { '\\', '/' }) >= 0 ||
            name == "." ||
            name == ".."
        ) return 87;

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
                FILE_READ_ATTRIBUTES | DELETE | SYNCHRONIZE,
                ref attributes,
                out statusBlock,
                IntPtr.Zero,
                0,
                FILE_SHARE_READ | FILE_SHARE_WRITE,
                FILE_OPEN,
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
            bool isDirectory =
                (information.FileAttributes & FILE_ATTRIBUTE_DIRECTORY) != 0;
            if (
                isDirectory != expectDirectory ||
                (information.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0
            )
            {
                CloseHandle(handle);
                handle = INVALID_HANDLE_VALUE;
                return 4390;
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

    private static int DeleteFileIfPresent(IntPtr parentHandle, string fileName)
    {
        IntPtr fileHandle;
        int openError = OpenOwnedFileRelative(parentHandle, fileName, out fileHandle);
        if (openError == 2 || openError == 3) return 0;
        if (openError != 0) return openError;
        int cleanupError = 0;
        try
        {
            cleanupError = MarkDirectoryForDeletion(fileHandle);
        }
        finally
        {
            if (!CloseHandle(fileHandle) && cleanupError == 0)
            {
                cleanupError = Marshal.GetLastWin32Error();
            }
        }
        return cleanupError;
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
    [Console]::Error.WriteLine("PROBE_CLEANUP_ERROR:87")
    exit 1
}

$errorCode = [TossTradingCalendarProbeCleanup]::Cleanup($probeRoot)
if ($errorCode -ne 0) {
    [Console]::Error.WriteLine("PROBE_CLEANUP_ERROR:{0}" -f $errorCode)
    exit 1
}
