[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$StagingRoot,
    [Parameter(Mandatory = $true)][string]$DestinationRoot
)

$ErrorActionPreference = "Stop"
$utf8WithoutBom = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = $utf8WithoutBom
$OutputEncoding = $utf8WithoutBom

Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Win32.SafeHandles;

public static class TossTradingCalendarPinnedFile
{
    private const uint GENERIC_READ = 0x80000000;
    private const uint FILE_LIST_DIRECTORY = 0x00000001;
    private const uint FILE_ADD_FILE = 0x00000002;
    private const uint FILE_ADD_SUBDIRECTORY = 0x00000004;
    private const uint FILE_TRAVERSE = 0x00000020;
    private const uint FILE_READ_ATTRIBUTES = 0x00000080;
    private const uint DELETE = 0x00010000;
    private const uint SYNCHRONIZE = 0x00100000;
    private const uint FILE_SHARE_READ = 0x00000001;
    private const uint FILE_SHARE_WRITE = 0x00000002;
    private const uint FILE_SHARE_DELETE = 0x00000004;
    private const uint OPEN_EXISTING = 3;
    private const uint FILE_OPEN = 1;
    private const uint FILE_CREATE = 2;
    private const uint FILE_DIRECTORY_FILE = 0x00000001;
    private const uint FILE_SYNCHRONOUS_IO_NONALERT = 0x00000020;
    private const uint FILE_OPEN_FOR_BACKUP_INTENT = 0x00004000;
    private const uint FILE_OPEN_REPARSE_POINT = 0x00200000;
    private const uint OBJ_CASE_INSENSITIVE = 0x00000040;
    private const uint FILE_FLAG_OPEN_REPARSE_POINT = 0x00200000;
    private const uint FILE_FLAG_BACKUP_SEMANTICS = 0x02000000;
    private const uint FILE_ATTRIBUTE_DIRECTORY = 0x00000010;
    private const uint FILE_ATTRIBUTE_REPARSE_POINT = 0x00000400;
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
    private struct FILE_ATTRIBUTE_TAG_INFO { public uint FileAttributes; public uint ReparseTag; }
    [StructLayout(LayoutKind.Sequential)]
    private struct BY_HANDLE_FILE_INFORMATION
    {
        public uint FileAttributes;
        public System.Runtime.InteropServices.ComTypes.FILETIME CreationTime;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastAccessTime;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWriteTime;
        public uint VolumeSerialNumber; public uint FileSizeHigh; public uint FileSizeLow;
        public uint NumberOfLinks; public uint FileIndexHigh; public uint FileIndexLow;
    }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateFileW(string name, uint access, uint share, IntPtr security, uint disposition, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetFileInformationByHandleEx(IntPtr file, int kind, out FILE_ATTRIBUTE_TAG_INFO info, uint size);
    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetFileInformationByHandle(IntPtr file, out BY_HANDLE_FILE_INFORMATION info);
    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", EntryPoint = "SetFileInformationByHandle", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetFileInformationByHandleBuffer(IntPtr file, int kind, IntPtr info, uint size);
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

    public static int Pin(string path, string expectedHash, long expectedLength, out IntPtr handle)
    {
        handle = CreateFileW(path, GENERIC_READ | FILE_READ_ATTRIBUTES | DELETE, FILE_SHARE_READ | FILE_SHARE_DELETE, IntPtr.Zero, OPEN_EXISTING, FILE_FLAG_OPEN_REPARSE_POINT, IntPtr.Zero);
        if (handle == INVALID_HANDLE_VALUE) return Marshal.GetLastWin32Error();
        FILE_ATTRIBUTE_TAG_INFO attributes;
        if (!GetFileInformationByHandleEx(handle, 9, out attributes, (uint)Marshal.SizeOf(typeof(FILE_ATTRIBUTE_TAG_INFO)))) return RejectPin(ref handle, Marshal.GetLastWin32Error());
        if ((attributes.FileAttributes & (FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_REPARSE_POINT)) != 0) return RejectPin(ref handle, 4390);
        bool matches;
        using (SafeFileHandle safe = new SafeFileHandle(handle, false))
        using (FileStream stream = new FileStream(safe, FileAccess.Read))
        using (SHA256 sha = SHA256.Create())
        {
            string actual = BitConverter.ToString(sha.ComputeHash(stream)).Replace("-", "").ToLowerInvariant();
            matches = stream.Length == expectedLength && String.Equals(actual, expectedHash, StringComparison.Ordinal);
        }
        return matches ? 0 : RejectPin(ref handle, 13);
    }

    public static int ReadIdentity(IntPtr handle, out string identity)
    {
        identity = null;
        BY_HANDLE_FILE_INFORMATION information;
        if (!GetFileInformationByHandle(handle, out information)) return Marshal.GetLastWin32Error();
        ulong fileIdentity = ((ulong)information.FileIndexHigh << 32) | information.FileIndexLow;
        identity = information.VolumeSerialNumber.ToString() + ":" + fileIdentity.ToString();
        return 0;
    }

    public static int VerifyRetained(IntPtr retained, string expectedHash, long expectedLength)
    {
        using (SafeFileHandle safe = new SafeFileHandle(retained, false))
        using (FileStream stream = new FileStream(safe, FileAccess.Read))
        using (SHA256 sha = SHA256.Create())
        {
            if (stream.Length != expectedLength) return 13;
            stream.Position = 0;
            string actual = BitConverter.ToString(sha.ComputeHash(stream)).Replace("-", "").ToLowerInvariant();
            return String.Equals(actual, expectedHash, StringComparison.Ordinal) ? 0 : 13;
        }
    }

    public static int OpenAbsoluteDirectory(string path, out IntPtr handle)
    {
        handle = CreateFileW(
            path,
            FILE_LIST_DIRECTORY | FILE_ADD_FILE | FILE_ADD_SUBDIRECTORY | FILE_TRAVERSE |
                FILE_READ_ATTRIBUTES | SYNCHRONIZE,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            IntPtr.Zero,
            OPEN_EXISTING,
            FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_BACKUP_SEMANTICS,
            IntPtr.Zero
        );
        if (handle == INVALID_HANDLE_VALUE) return Marshal.GetLastWin32Error();
        return InspectDirectory(ref handle);
    }

    public static int OpenRelativeDirectory(
        IntPtr parentHandle,
        string name,
        out IntPtr handle
    )
    {
        return OpenRelativeDirectoryCore(
            parentHandle,
            name,
            FILE_OPEN,
            out handle
        );
    }

    public static int CreateRelativeDirectory(
        IntPtr parentHandle,
        string name,
        out IntPtr handle
    )
    {
        return OpenRelativeDirectoryCore(
            parentHandle,
            name,
            FILE_CREATE,
            out handle
        );
    }

    private static int OpenRelativeDirectoryCore(
        IntPtr parentHandle,
        string name,
        uint disposition,
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
                FILE_LIST_DIRECTORY | FILE_ADD_FILE | FILE_ADD_SUBDIRECTORY | FILE_TRAVERSE |
                    FILE_READ_ATTRIBUTES | DELETE | SYNCHRONIZE,
                ref attributes,
                out statusBlock,
                IntPtr.Zero,
                0,
                FILE_SHARE_READ | FILE_SHARE_WRITE,
                disposition,
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
            return InspectDirectory(ref handle);
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

    public static int VerifyExistingPackage(
        string destinationRoot,
        string[] relativePaths,
        string[] expectedHashes,
        long[] expectedLengths,
        List<IntPtr> existingHandles
    )
    {
        int exactTreeError = VerifyExactTree(destinationRoot, relativePaths);
        if (exactTreeError != 0) return exactTreeError;
        bool succeeded = false;
        try
        {
            for (int index = 0; index < relativePaths.Length; index++)
            {
                IntPtr existing;
                int error = PinExisting(
                    Path.Combine(destinationRoot, relativePaths[index].Replace('/', '\\')),
                    expectedHashes[index],
                    expectedLengths[index],
                    out existing
                );
                if (error != 0) return error;
                existingHandles.Add(existing);
            }
            int finalTreeError = VerifyExactTree(destinationRoot, relativePaths);
            succeeded = finalTreeError == 0;
            return finalTreeError;
        }
        finally
        {
            if (!succeeded)
            {
                foreach (IntPtr existing in existingHandles) CloseHandle(existing);
                existingHandles.Clear();
            }
        }
    }

    public static int PinExisting(
        string path,
        string expectedHash,
        long expectedLength,
        out IntPtr handle
    )
    {
        handle = CreateFileW(
            path,
            GENERIC_READ | FILE_READ_ATTRIBUTES,
            FILE_SHARE_READ,
            IntPtr.Zero,
            OPEN_EXISTING,
            FILE_FLAG_OPEN_REPARSE_POINT,
            IntPtr.Zero
        );
        if (handle == INVALID_HANDLE_VALUE) return Marshal.GetLastWin32Error();
        FILE_ATTRIBUTE_TAG_INFO attributes;
        if (!GetFileInformationByHandleEx(handle, 9, out attributes, (uint)Marshal.SizeOf(typeof(FILE_ATTRIBUTE_TAG_INFO)))) return RejectPin(ref handle, Marshal.GetLastWin32Error());
        if ((attributes.FileAttributes & (FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_REPARSE_POINT)) != 0) return RejectPin(ref handle, 4390);
        bool matches;
        using (SafeFileHandle safe = new SafeFileHandle(handle, false))
        using (FileStream stream = new FileStream(safe, FileAccess.Read))
        using (SHA256 sha = SHA256.Create())
        {
            string actual = BitConverter.ToString(sha.ComputeHash(stream)).Replace("-", "").ToLowerInvariant();
            matches = stream.Length == expectedLength && String.Equals(actual, expectedHash, StringComparison.Ordinal);
        }
        return matches ? 0 : RejectPin(ref handle, 13);
    }

    public static int MovePinnedFileNoReplace(IntPtr retained, string destinationPath)
    {
        byte[] nameBytes = Encoding.Unicode.GetBytes(destinationPath);
        int rootOffset = IntPtr.Size == 8 ? 8 : 4;
        int lengthOffset = rootOffset + IntPtr.Size;
        int nameOffset = lengthOffset + sizeof(uint);
        IntPtr buffer = Marshal.AllocHGlobal(nameOffset + nameBytes.Length + 2);
        try
        {
            for (int index = 0; index < nameOffset + nameBytes.Length + 2; index++) Marshal.WriteByte(buffer, index, 0);
            Marshal.WriteInt32(buffer, 0, 0);
            Marshal.WriteIntPtr(buffer, rootOffset, IntPtr.Zero);
            Marshal.WriteInt32(buffer, lengthOffset, nameBytes.Length);
            Marshal.Copy(nameBytes, 0, IntPtr.Add(buffer, nameOffset), nameBytes.Length);
            bool renamed = SetFileInformationByHandleBuffer(retained, 3, buffer, checked((uint)(nameOffset + nameBytes.Length + 2)));
            return renamed ? 0 : Marshal.GetLastWin32Error();
        }
        finally { Marshal.FreeHGlobal(buffer); }
    }

    public static int VerifyExactTree(string destinationRoot, string[] relativePaths)
    {
        try
        {
            string artifactPath = Path.Combine(destinationRoot, "artifact.json");
            string sourcesPath = Path.Combine(destinationRoot, "sources");
            string hashesPath = Path.Combine(sourcesPath, "sha256");
            if (!HasExactEntries(destinationRoot, new string[] { artifactPath, sourcesPath })) return 13;
            if (!HasExactEntries(sourcesPath, new string[] { hashesPath })) return 13;
            List<string> expectedHashes = new List<string>();
            foreach (string relativePath in relativePaths)
            {
                if (relativePath != "artifact.json")
                {
                    expectedHashes.Add(Path.Combine(destinationRoot, relativePath.Replace('/', '\\')));
                }
            }
            if (!HasExactEntries(hashesPath, expectedHashes.ToArray())) return 13;
            if ((File.GetAttributes(artifactPath) & (FileAttributes.Directory | FileAttributes.ReparsePoint)) != 0) return 4390;
            if ((File.GetAttributes(sourcesPath) & (FileAttributes.Directory | FileAttributes.ReparsePoint)) != FileAttributes.Directory) return 4390;
            if ((File.GetAttributes(hashesPath) & (FileAttributes.Directory | FileAttributes.ReparsePoint)) != FileAttributes.Directory) return 4390;
            foreach (string expectedHash in expectedHashes)
            {
                if ((File.GetAttributes(expectedHash) & (FileAttributes.Directory | FileAttributes.ReparsePoint)) != 0) return 4390;
            }
            return 0;
        }
        catch { return 13; }
    }

    private static bool HasExactEntries(string directory, string[] expected)
    {
        string[] actual = Directory.GetFileSystemEntries(directory);
        Array.Sort(actual, StringComparer.Ordinal);
        Array.Sort(expected, StringComparer.Ordinal);
        if (actual.Length != expected.Length) return false;
        for (int index = 0; index < actual.Length; index++)
        {
            if (!String.Equals(actual[index], expected[index], StringComparison.Ordinal)) return false;
        }
        return true;
    }

    public static int PinPublished(string path, string expectedIdentity, string expectedHash, long expectedLength, out IntPtr current)
    {
        current = CreateFileW(path, GENERIC_READ | FILE_READ_ATTRIBUTES, FILE_SHARE_READ, IntPtr.Zero, OPEN_EXISTING, FILE_FLAG_OPEN_REPARSE_POINT, IntPtr.Zero);
        if (current == INVALID_HANDLE_VALUE) return Marshal.GetLastWin32Error();
        FILE_ATTRIBUTE_TAG_INFO attributes;
        if (!GetFileInformationByHandleEx(current, 9, out attributes, (uint)Marshal.SizeOf(typeof(FILE_ATTRIBUTE_TAG_INFO)))) return RejectPin(ref current, Marshal.GetLastWin32Error());
        if ((attributes.FileAttributes & (FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_REPARSE_POINT)) != 0) return RejectPin(ref current, 4390);
        string actualIdentity;
        int identityError = ReadIdentity(current, out actualIdentity);
        if (identityError != 0) return RejectPin(ref current, identityError);
        if (!String.Equals(actualIdentity, expectedIdentity, StringComparison.Ordinal)) return RejectPin(ref current, 1168);
        bool matches;
        using (SafeFileHandle safe = new SafeFileHandle(current, false))
        using (FileStream stream = new FileStream(safe, FileAccess.Read))
        using (SHA256 sha = SHA256.Create())
        {
            string actual = BitConverter.ToString(sha.ComputeHash(stream)).Replace("-", "").ToLowerInvariant();
            matches = stream.Length == expectedLength && String.Equals(actual, expectedHash, StringComparison.Ordinal);
        }
        return matches ? 0 : RejectPin(ref current, 13);
    }

    public static int Close(ref IntPtr handle)
    {
        if (handle == IntPtr.Zero || handle == INVALID_HANDLE_VALUE) { handle = IntPtr.Zero; return 0; }
        bool closed = CloseHandle(handle); int error = closed ? 0 : Marshal.GetLastWin32Error(); handle = IntPtr.Zero; return error;
    }

    private static int RejectPin(ref IntPtr handle, int error)
    {
        if (handle != IntPtr.Zero && handle != INVALID_HANDLE_VALUE) CloseHandle(handle);
        handle = IntPtr.Zero;
        return error;
    }

    private static int InspectDirectory(ref IntPtr handle)
    {
        FILE_ATTRIBUTE_TAG_INFO attributes;
        if (!GetFileInformationByHandleEx(
            handle,
            9,
            out attributes,
            (uint)Marshal.SizeOf(typeof(FILE_ATTRIBUTE_TAG_INFO))
        )) return RejectPin(ref handle, Marshal.GetLastWin32Error());
        if (
            (attributes.FileAttributes &
                (FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_REPARSE_POINT)) !=
            FILE_ATTRIBUTE_DIRECTORY
        ) return RejectPin(ref handle, 4390);
        return 0;
    }

    private static bool IsSingleComponent(string name)
    {
        return
            !String.IsNullOrEmpty(name) &&
            name != "." &&
            name != ".." &&
            name.IndexOfAny(new char[] { '\\', '/' }) < 0;
    }
}
"@

$stagingRoot = [System.IO.Path]::GetFullPath($StagingRoot)
$destinationRoot = [System.IO.Path]::GetFullPath($DestinationRoot)
$namespaceRoot = [System.IO.Directory]::GetParent($destinationRoot).FullName
$destinationName = [System.IO.Path]::GetFileName($destinationRoot)
$relativePaths = [System.Collections.Generic.List[string]]::new()
$expectedHashes = [System.Collections.Generic.List[string]]::new()
$expectedLengths = [System.Collections.Generic.List[long]]::new()
$expectedIdentities = [System.Collections.Generic.List[string]]::new()
$handles = [System.Collections.Generic.List[IntPtr]]::new()
$publishedHandles = [System.Collections.Generic.List[IntPtr]]::new()
$namespaceHandle = [IntPtr]::Zero
$destinationHandle = [IntPtr]::Zero
$sourcesHandle = [IntPtr]::Zero
$hashesHandle = [IntPtr]::Zero
$sessionError = 0
try {
    while ($true) {
        $line = [Console]::In.ReadLine()
        if ($null -eq $line) { $sessionError = 87; break }
        if ($line -eq "END") { break }
        if ($line -cnotmatch '^(artifact\.json|sources/sha256/[a-f0-9]{64}\.bin)\|sha256:([a-f0-9]{64})\|([0-9]+)$') { $sessionError = 87; break }
        $relativePath = $Matches[1]
        if ($relativePaths.Contains($relativePath)) { $sessionError = 87; break }
        $handle = [IntPtr]::Zero
        $sessionError = [TossTradingCalendarPinnedFile]::Pin(
            (Join-Path $stagingRoot $relativePath.Replace('/', '\')),
            $Matches[2],
            [long]$Matches[3],
            [ref]$handle
        )
        if ($sessionError -ne 0) { break }
        $identity = $null
        $sessionError = [TossTradingCalendarPinnedFile]::ReadIdentity(
            $handle,
            [ref]$identity
        )
        if ($sessionError -ne 0) { break }
        $relativePaths.Add($relativePath)
        $expectedHashes.Add($Matches[2])
        $expectedLengths.Add([long]$Matches[3])
        $expectedIdentities.Add($identity)
        $handles.Add($handle)
    }
    if ($sessionError -eq 0) {
        [Console]::Out.WriteLine("PACKAGE_FILES_PINNED:{0}" -f $handles.Count)
        [Console]::Out.Flush()
        $command = [Console]::In.ReadLine()
        if ($command -eq "PUBLISH") {
            $collision = $false
            $destinationCreated = $false
            for ($index = 0; $index -lt $handles.Count; $index++) {
                $sessionError = [TossTradingCalendarPinnedFile]::VerifyRetained(
                    $handles[$index],
                    $expectedHashes[$index],
                    $expectedLengths[$index]
                )
                if ($sessionError -ne 0) { break }
            }
            if ($sessionError -eq 0) {
                $sessionError = [TossTradingCalendarPinnedFile]::OpenAbsoluteDirectory(
                    $namespaceRoot,
                    [ref]$namespaceHandle
                )
            }
            if ($sessionError -eq 0) {
                $sessionError = [TossTradingCalendarPinnedFile]::CreateRelativeDirectory(
                    $namespaceHandle,
                    $destinationName,
                    [ref]$destinationHandle
                )
                if ($sessionError -eq 0) { $destinationCreated = $true }
            }
            if ($sessionError -eq 80 -or $sessionError -eq 183) {
                $sessionError = [TossTradingCalendarPinnedFile]::OpenRelativeDirectory(
                    $namespaceHandle,
                    $destinationName,
                    [ref]$destinationHandle
                )
            }
            if (
                -not $destinationCreated -and
                $destinationHandle -ne [IntPtr]::Zero -and
                $sessionError -eq 0 -and
                (Test-Path -LiteralPath $destinationRoot)
            ) {
                $sessionError = [TossTradingCalendarPinnedFile]::VerifyExistingPackage(
                    $destinationRoot,
                    $relativePaths.ToArray(),
                    $expectedHashes.ToArray(),
                    $expectedLengths.ToArray(),
                    $publishedHandles
                )
                if ($sessionError -eq 0) {
                    $collision = $true
                    [Console]::Out.WriteLine("PACKAGE_DIRECTORY_COLLISION")
                }
                else {
                    $quarantinePath = "{0}.quarantine-{1}" -f $destinationRoot, [Guid]::NewGuid().ToString("D")
                    $sessionError = [TossTradingCalendarPinnedFile]::MovePinnedFileNoReplace(
                        $destinationHandle,
                        $quarantinePath
                    )
                    if ($sessionError -eq 0) {
                        $sessionError = [TossTradingCalendarPinnedFile]::Close(
                            [ref]$destinationHandle
                        )
                    }
                    if ($sessionError -eq 0) {
                        [Console]::Out.WriteLine("PACKAGE_PARTIAL_DIRECTORY_QUARANTINED")
                        [Console]::Out.Flush()
                        $sessionError = [TossTradingCalendarPinnedFile]::CreateRelativeDirectory(
                            $namespaceHandle,
                            $destinationName,
                            [ref]$destinationHandle
                        )
                        if ($sessionError -eq 0) { $destinationCreated = $true }
                    }
                }
            }
            if (-not $collision -and $sessionError -eq 0) {
                $sessionError = [TossTradingCalendarPinnedFile]::CreateRelativeDirectory(
                    $destinationHandle,
                    "sources",
                    [ref]$sourcesHandle
                )
            }
            if (-not $collision -and $sessionError -eq 0) {
                $sessionError = [TossTradingCalendarPinnedFile]::CreateRelativeDirectory(
                    $sourcesHandle,
                    "sha256",
                    [ref]$hashesHandle
                )
            }
            for ($index = 0; $index -lt $handles.Count; $index++) {
                if ($collision -or $sessionError -ne 0) { break }
                $sessionError = [TossTradingCalendarPinnedFile]::MovePinnedFileNoReplace(
                    $handles[$index],
                    (Join-Path $destinationRoot $relativePaths[$index].Replace('/', '\'))
                )
            }
            if (-not $collision -and $sessionError -eq 0) {
                [Console]::Out.WriteLine("PACKAGE_DIRECTORY_PUBLISHED")
                [Console]::Out.Flush()
            }
            for ($index = 0; $index -lt $handles.Count; $index++) {
                if ($collision -or $sessionError -ne 0) { break }
                $handle = $handles[$index]
                $sessionError = [TossTradingCalendarPinnedFile]::Close([ref]$handle)
                $handles[$index] = [IntPtr]::Zero
            }
            for ($index = 0; $index -lt $handles.Count; $index++) {
                if ($collision -or $sessionError -ne 0) { break }
                $publishedHandle = [IntPtr]::Zero
                $sessionError = [TossTradingCalendarPinnedFile]::PinPublished(
                    (Join-Path $destinationRoot $relativePaths[$index].Replace('/', '\')),
                    $expectedIdentities[$index],
                    $expectedHashes[$index],
                    $expectedLengths[$index],
                    [ref]$publishedHandle
                )
                if ($sessionError -ne 0) { break }
                $publishedHandles.Add($publishedHandle)
            }
            if (-not $collision -and $sessionError -eq 0) {
                $sessionError = [TossTradingCalendarPinnedFile]::VerifyExactTree(
                    $destinationRoot,
                    $relativePaths.ToArray()
                )
            }
            if (-not $collision -and $sessionError -eq 0) {
                [Console]::Out.WriteLine("PACKAGE_FILES_VERIFIED")
                [Console]::Out.Flush()
                $completionCommand = [Console]::In.ReadLine()
                if ($completionCommand -ne "COMPLETE") { $sessionError = 87 }
                if ($sessionError -eq 0) {
                    $sessionError = [TossTradingCalendarPinnedFile]::VerifyExactTree(
                        $destinationRoot,
                        $relativePaths.ToArray()
                    )
                }
            }
        }
        elseif ($command -ne "RELEASE") { $sessionError = 87 }
    }
}
finally {
    for ($index = 0; $index -lt $publishedHandles.Count; $index++) {
        $handle = $publishedHandles[$index]
        $closeError = [TossTradingCalendarPinnedFile]::Close([ref]$handle)
        if ($sessionError -eq 0) { $sessionError = $closeError }
    }
    for ($index = 0; $index -lt $handles.Count; $index++) {
        $handle = $handles[$index]
        $closeError = [TossTradingCalendarPinnedFile]::Close([ref]$handle)
        if ($sessionError -eq 0) { $sessionError = $closeError }
    }
    foreach ($directoryHandleName in @(
        'hashesHandle',
        'sourcesHandle',
        'destinationHandle',
        'namespaceHandle'
    )) {
        $directoryHandle = Get-Variable -Name $directoryHandleName -ValueOnly
        $closeError = [TossTradingCalendarPinnedFile]::Close(
            [ref]$directoryHandle
        )
        Set-Variable -Name $directoryHandleName -Value $directoryHandle
        if ($sessionError -eq 0) { $sessionError = $closeError }
    }
}
if ($sessionError -ne 0) { [Console]::Error.WriteLine("PACKAGE_FILES_ERROR:{0}" -f $sessionError); exit 1 }
