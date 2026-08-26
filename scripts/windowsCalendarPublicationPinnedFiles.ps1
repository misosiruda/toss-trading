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
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using Microsoft.Win32.SafeHandles;

public static class TossTradingCalendarPinnedFile
{
    private const uint GENERIC_READ = 0x80000000;
    private const uint FILE_READ_ATTRIBUTES = 0x00000080;
    private const uint FILE_SHARE_READ = 0x00000001;
    private const uint OPEN_EXISTING = 3;
    private const uint FILE_FLAG_OPEN_REPARSE_POINT = 0x00200000;
    private const uint MOVEFILE_WRITE_THROUGH = 0x00000008;
    private const uint FILE_ATTRIBUTE_DIRECTORY = 0x00000010;
    private const uint FILE_ATTRIBUTE_REPARSE_POINT = 0x00000400;
    private static readonly IntPtr INVALID_HANDLE_VALUE = new IntPtr(-1);

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
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool MoveFileExW(string existingName, string newName, uint flags);

    public static int Pin(string path, string expectedHash, long expectedLength, out IntPtr handle)
    {
        handle = CreateFileW(path, GENERIC_READ | FILE_READ_ATTRIBUTES, FILE_SHARE_READ, IntPtr.Zero, OPEN_EXISTING, FILE_FLAG_OPEN_REPARSE_POINT, IntPtr.Zero);
        if (handle == INVALID_HANDLE_VALUE) return Marshal.GetLastWin32Error();
        FILE_ATTRIBUTE_TAG_INFO attributes;
        if (!GetFileInformationByHandleEx(handle, 9, out attributes, (uint)Marshal.SizeOf(typeof(FILE_ATTRIBUTE_TAG_INFO)))) return Marshal.GetLastWin32Error();
        if ((attributes.FileAttributes & (FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_REPARSE_POINT)) != 0) return 4390;
        using (SafeFileHandle safe = new SafeFileHandle(handle, false))
        using (FileStream stream = new FileStream(safe, FileAccess.Read))
        using (SHA256 sha = SHA256.Create())
        {
            if (stream.Length != expectedLength) return 13;
            string actual = BitConverter.ToString(sha.ComputeHash(stream)).Replace("-", "").ToLowerInvariant();
            if (!String.Equals(actual, expectedHash, StringComparison.Ordinal)) return 13;
        }
        return 0;
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

    public static int MoveNoReplace(string sourcePath, string destinationPath)
    {
        return MoveFileExW(sourcePath, destinationPath, MOVEFILE_WRITE_THROUGH)
            ? 0
            : Marshal.GetLastWin32Error();
    }

    public static int VerifyPublished(string path, string expectedIdentity, string expectedHash, long expectedLength)
    {
        IntPtr current = CreateFileW(path, GENERIC_READ | FILE_READ_ATTRIBUTES, FILE_SHARE_READ, IntPtr.Zero, OPEN_EXISTING, FILE_FLAG_OPEN_REPARSE_POINT, IntPtr.Zero);
        if (current == INVALID_HANDLE_VALUE) return Marshal.GetLastWin32Error();
        try
        {
            string actualIdentity;
            int identityError = ReadIdentity(current, out actualIdentity);
            if (identityError != 0) return identityError;
            if (!String.Equals(actualIdentity, expectedIdentity, StringComparison.Ordinal)) return 1168;
            using (SafeFileHandle safe = new SafeFileHandle(current, false))
            using (FileStream stream = new FileStream(safe, FileAccess.Read))
            using (SHA256 sha = SHA256.Create())
            {
                if (stream.Length != expectedLength) return 13;
                stream.Position = 0;
                string actual = BitConverter.ToString(sha.ComputeHash(stream)).Replace("-", "").ToLowerInvariant();
                return String.Equals(actual, expectedHash, StringComparison.Ordinal) ? 0 : 13;
            }
        }
        finally { CloseHandle(current); }
    }

    public static int Close(ref IntPtr handle)
    {
        if (handle == IntPtr.Zero || handle == INVALID_HANDLE_VALUE) { handle = IntPtr.Zero; return 0; }
        bool closed = CloseHandle(handle); int error = closed ? 0 : Marshal.GetLastWin32Error(); handle = IntPtr.Zero; return error;
    }
}
"@

$stagingRoot = [System.IO.Path]::GetFullPath($StagingRoot)
$destinationRoot = [System.IO.Path]::GetFullPath($DestinationRoot)
$relativePaths = [System.Collections.Generic.List[string]]::new()
$expectedHashes = [System.Collections.Generic.List[string]]::new()
$expectedLengths = [System.Collections.Generic.List[long]]::new()
$expectedIdentities = [System.Collections.Generic.List[string]]::new()
$handles = [System.Collections.Generic.List[IntPtr]]::new()
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
            for ($index = 0; $index -lt $handles.Count; $index++) {
                $sessionError = [TossTradingCalendarPinnedFile]::VerifyRetained(
                    $handles[$index],
                    $expectedHashes[$index],
                    $expectedLengths[$index]
                )
                if ($sessionError -ne 0) { break }
            }
            for ($index = 0; $index -lt $handles.Count; $index++) {
                $handle = $handles[$index]
                $closeError = [TossTradingCalendarPinnedFile]::Close([ref]$handle)
                $handles[$index] = [IntPtr]::Zero
                if ($sessionError -eq 0) { $sessionError = $closeError }
            }
            if ($sessionError -eq 0) {
                $sessionError = [TossTradingCalendarPinnedFile]::MoveNoReplace(
                    $stagingRoot,
                    $destinationRoot
                )
            }
            if ($sessionError -eq 80 -or $sessionError -eq 183) {
                $sessionError = 0
                $collision = $true
                [Console]::Out.WriteLine("PACKAGE_DIRECTORY_COLLISION")
            }
            elseif ($sessionError -eq 0) {
                [Console]::Out.WriteLine("PACKAGE_DIRECTORY_PUBLISHED")
                [Console]::Out.Flush()
            }
            for ($index = 0; $index -lt $handles.Count; $index++) {
                if ($collision -or $sessionError -ne 0) { break }
                $sessionError = [TossTradingCalendarPinnedFile]::VerifyPublished(
                    (Join-Path $destinationRoot $relativePaths[$index].Replace('/', '\')),
                    $expectedIdentities[$index],
                    $expectedHashes[$index],
                    $expectedLengths[$index]
                )
                if ($sessionError -ne 0) { break }
            }
            if (-not $collision -and $sessionError -eq 0) {
                [Console]::Out.WriteLine("PACKAGE_FILES_VERIFIED")
            }
        }
        elseif ($command -ne "RELEASE") { $sessionError = 87 }
    }
}
finally {
    for ($index = 0; $index -lt $handles.Count; $index++) {
        $handle = $handles[$index]
        $closeError = [TossTradingCalendarPinnedFile]::Close([ref]$handle)
        if ($sessionError -eq 0) { $sessionError = $closeError }
    }
}
if ($sessionError -ne 0) { [Console]::Error.WriteLine("PACKAGE_FILES_ERROR:{0}" -f $sessionError); exit 1 }
