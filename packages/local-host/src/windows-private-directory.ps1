param(
  [Parameter(Mandatory=$true)][ValidateSet('InitializeDirectory','VerifyDirectory','VerifyFile')][string]$Operation,
  [Parameter(Mandatory=$true)][string]$Anchor,
  [Parameter(Mandatory=$true)][string]$Name
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding
Set-StrictMode -Version Latest
try {
  if (-not [Environment]::Is64BitProcess -or $PSVersionTable.PSVersion.Major -lt 5) { throw 'unsupported-runtime' }
  if ($Name -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$' -and $Name -notmatch '^\.rendezvous-[a-f0-9-]{36}$') { throw 'invalid-name' }
  if ($Name -eq '.' -or $Name -eq '..' -or $Name.EndsWith('.') -or $Name -match '^(?i:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)') { throw 'invalid-name' }
  $root = [IO.Path]::GetFullPath($Anchor).TrimEnd('\')
  if ($root -notmatch '^[A-Za-z]:\\' -or $root.StartsWith('\\')) { throw 'unsupported-root' }
  $drive = [IO.DriveInfo]::new([IO.Path]::GetPathRoot($root))
  if ($drive.DriveType -ne [IO.DriveType]::Fixed -or $drive.DriveFormat -ne 'NTFS') { throw [PlatformNotSupportedException]::new('private-profile-requires-local-ntfs') }
  $target = [IO.Path]::GetFullPath([IO.Path]::Combine($root, $Name))
  if (-not [String]::Equals([IO.Path]::GetDirectoryName($target), $root, [StringComparison]::OrdinalIgnoreCase)) { throw 'outside-anchor' }
  $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
  $system = [Security.Principal.SecurityIdentifier]::new('S-1-5-18')

  Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class PetLocalHostPrivateNativeV1 {
  [StructLayout(LayoutKind.Sequential)] public struct Info {
    public uint Attributes;
    public System.Runtime.InteropServices.ComTypes.FILETIME Created;
    public System.Runtime.InteropServices.ComTypes.FILETIME Accessed;
    public System.Runtime.InteropServices.ComTypes.FILETIME Written;
    public uint Volume;
    public uint SizeHigh;
    public uint SizeLow;
    public uint Links;
    public uint IndexHigh;
    public uint IndexLow;
  }
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, ExactSpelling=true, SetLastError=true)]
  static extern SafeFileHandle CreateFileW(string name, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern bool GetFileInformationByHandle(SafeFileHandle handle, out Info info);
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern uint GetFileType(SafeFileHandle handle);
  public static Info Inspect(string name) {
    // READ_CONTROL | FILE_READ_ATTRIBUTES; share all; OPEN_EXISTING; OPEN_REPARSE_POINT | BACKUP_SEMANTICS.
    using (SafeFileHandle handle = CreateFileW(name, 0x20080, 7, IntPtr.Zero, 3, 0x02200000, IntPtr.Zero)) {
      if (handle.IsInvalid) throw new IOException("private-open-failed");
      Info info;
      if (!GetFileInformationByHandle(handle, out info) || GetFileType(handle) != 1) throw new IOException("private-info-failed");
      return info;
    }
  }
}
'@
  function Assert-NoReparse([string]$value) {
    $cursor = $value
    while ($cursor) {
      if (([IO.File]::GetAttributes($cursor) -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'reparse-entry' }
      $parent = [IO.Path]::GetDirectoryName($cursor)
      if ([String]::Equals($cursor, $parent, [StringComparison]::OrdinalIgnoreCase)) { break }
      $cursor = $parent
    }
  }
  function Assert-Owner([string]$value) {
    $acl = Get-Acl -LiteralPath $value
    if ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid.Value) { throw 'foreign-owner' }
    return $acl
  }
  function Assert-PrivateAcl([string]$value, [bool]$directory) {
    $acl = Assert-Owner $value
    if ($directory -and -not $acl.AreAccessRulesProtected) { throw 'unprotected-directory' }
    $ownerFull = $false
    foreach ($rule in $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
      if ($rule.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow) { throw 'unexpected-denial' }
      if ($rule.IdentityReference.Value -ne $sid.Value -and $rule.IdentityReference.Value -ne $system.Value) { throw 'foreign-access' }
      if ($rule.IdentityReference.Value -eq $sid.Value -and ($rule.FileSystemRights -band [Security.AccessControl.FileSystemRights]::FullControl) -eq [Security.AccessControl.FileSystemRights]::FullControl) { $ownerFull = $true }
    }
    if (-not $ownerFull) { throw 'owner-rights-missing' }
  }
  Assert-NoReparse $root
  $null = Assert-Owner $root
  if ($Operation -eq 'InitializeDirectory' -and -not [IO.Directory]::Exists($target)) {
    if ([IO.File]::Exists($target)) { throw 'wrong-kind' }
    $security = [Security.AccessControl.DirectorySecurity]::new()
    $security.SetOwner($sid)
    $security.SetAccessRuleProtection($true, $false)
    $inherit = [Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit
    foreach ($principal in @($sid, $system)) {
      $rule = [Security.AccessControl.FileSystemAccessRule]::new($principal, [Security.AccessControl.FileSystemRights]::FullControl, $inherit, [Security.AccessControl.PropagationFlags]::None, [Security.AccessControl.AccessControlType]::Allow)
      $null = $security.AddAccessRule($rule)
    }
    # This overload applies the descriptor during creation, rather than repairing existing ACLs.
    $null = [IO.Directory]::CreateDirectory($target, $security)
  }
  if ($Operation -eq 'VerifyFile') {
    try { $null = [IO.File]::GetAttributes($target) }
    catch [IO.FileNotFoundException] { exit 3 }
    catch [IO.DirectoryNotFoundException] { exit 3 }
  }
  Assert-NoReparse $target
  $info = [PetLocalHostPrivateNativeV1]::Inspect($target)
  $directory = ($info.Attributes -band 0x10) -ne 0
  if (($info.Attributes -band 0x400) -ne 0 -or ($info.Attributes -band 0x40) -ne 0) { throw 'nonregular-entry' }
  if ($Operation -eq 'VerifyFile') {
    if ($directory -or $info.Links -ne 1) { throw 'nonregular-or-hardlinked-file' }
    Assert-PrivateAcl $root $true
  } elseif (-not $directory) { throw 'not-directory' }
  Assert-PrivateAcl $target $directory
  @{ version = 1; kind = $(if ($directory) { 'directory' } else { 'file' }); path = $target; userSid = $sid.Value; volumeId = $info.Volume.ToString('x8'); fileId = ($info.IndexHigh.ToString('x8') + $info.IndexLow.ToString('x8')); links = $info.Links } | ConvertTo-Json -Compress
  exit 0
} catch [PlatformNotSupportedException] {
  [Console]::Error.WriteLine('local-host-private-profile-not-ready:private-profile-requires-local-ntfs')
  exit 2
} catch {
  # Report only fixed failure reasons, never exception text that may contain user paths.
  $reason = [string]$_.Exception.Message
  if ($reason -notin @('unsupported-runtime', 'invalid-name', 'unsupported-root', 'outside-anchor', 'reparse-entry', 'foreign-owner', 'unprotected-directory', 'unexpected-denial', 'foreign-access', 'owner-rights-missing', 'wrong-kind', 'nonregular-entry', 'nonregular-or-hardlinked-file', 'not-directory')) { $reason = 'script-error' }
  [Console]::Error.WriteLine('local-host-private-profile-unavailable:' + $reason)
  exit 1
}
