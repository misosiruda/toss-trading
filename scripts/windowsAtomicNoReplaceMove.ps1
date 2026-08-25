[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$SourcePath,

    [Parameter(Mandatory = $true)]
    [string]$DestinationPath
)

$ErrorActionPreference = "Stop"

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public static class TossTradingAtomicMove
{
    public const uint MOVEFILE_WRITE_THROUGH = 0x00000008;

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool MoveFileExW(
        string existingFileName,
        string newFileName,
        uint flags
    );
}
"@

$source = [System.IO.Path]::GetFullPath($SourcePath)
$destination = [System.IO.Path]::GetFullPath($DestinationPath)
$moved = [TossTradingAtomicMove]::MoveFileExW(
    $source,
    $destination,
    [TossTradingAtomicMove]::MOVEFILE_WRITE_THROUGH
)

if (-not $moved) {
    $errorCode = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
    [Console]::Error.WriteLine("MOVEFILEEX_ERROR:{0}" -f $errorCode)
    exit 1
}
