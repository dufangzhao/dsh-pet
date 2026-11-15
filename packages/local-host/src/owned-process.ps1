param(
  [Parameter(Mandatory=$true)][ValidateSet('Capture','Inspect')][string]$Operation,
  [Parameter(Mandatory=$true)][ValidateRange(1,4294967295)][uint32]$ProcessId
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding
try {
  if (-not [Environment]::Is64BitProcess -or $PSVersionTable.PSVersion.Major -lt 5) { throw 'unsupported-runtime' }
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class PetOwnedProcessNativeV1 {
  [StructLayout(LayoutKind.Sequential)] struct BootEnvironment {
    public Guid BootIdentifier;
    public uint FirmwareType;
    public ulong BootFlags;
  }
  [StructLayout(LayoutKind.Sequential)] struct FileTime { public uint Low; public uint High; }
  [DllImport("ntdll.dll", ExactSpelling=true)]
  static extern int NtQuerySystemInformation(int kind, out BootEnvironment info, int size, out int returned);
  [DllImport("kernel32.dll", SetLastError=true, ExactSpelling=true)]
  static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("kernel32.dll", SetLastError=true, ExactSpelling=true)]
  static extern bool GetProcessTimes(IntPtr process, out FileTime creation, out FileTime exit, out FileTime kernel, out FileTime user);
  [DllImport("kernel32.dll", SetLastError=true, ExactSpelling=true)]
  static extern uint WaitForSingleObject(IntPtr process, uint milliseconds);
  [DllImport("kernel32.dll", ExactSpelling=true)]
  static extern bool CloseHandle(IntPtr handle);
  public static string Boot() {
    BootEnvironment info; int returned;
    // SYSTEM_INFORMATION_CLASS.SystemBootEnvironmentInformation (90), queried from the kernel.
    if (NtQuerySystemInformation(90, out info, Marshal.SizeOf(typeof(BootEnvironment)), out returned) != 0 || info.BootIdentifier == Guid.Empty) throw new InvalidOperationException("boot-identity-unavailable");
    return info.BootIdentifier.ToString("D").ToLowerInvariant();
  }
  public sealed class Observation { public string status; public string osBootIdentity; public string processCreationIdentity; }
  public static Observation Inspect(uint pid) {
    Observation result = new Observation { osBootIdentity = Boot(), processCreationIdentity = null, status = "unverifiable" };
    // SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION. No terminate, suspend or debug access.
    IntPtr handle = OpenProcess(0x00101000, false, pid);
    if (handle == IntPtr.Zero) {
      int error = Marshal.GetLastWin32Error();
      result.status = error == 87 ? "not-found" : error == 5 ? "access-denied" : "unverifiable";
      return result;
    }
    try {
      FileTime creation, exited, kernel, user;
      if (!GetProcessTimes(handle, out creation, out exited, out kernel, out user)) return result;
      result.processCreationIdentity = (((ulong)creation.High << 32) | creation.Low).ToString(System.Globalization.CultureInfo.InvariantCulture);
      uint state = WaitForSingleObject(handle, 0);
      result.status = state == 0 ? "exited" : state == 258 ? "live" : "unverifiable";
      return result;
    } finally { CloseHandle(handle); }
  }
}
'@
  $observation = [PetOwnedProcessNativeV1]::Inspect([uint32]$ProcessId)
  if ($Operation -eq 'Capture' -and $observation.status -ne 'live') { throw 'capture-not-live' }
  @{ status = $observation.status; osBootIdentity = $observation.osBootIdentity; processCreationIdentity = $observation.processCreationIdentity } | ConvertTo-Json -Compress
  exit 0
} catch {
  [Console]::Error.WriteLine('local-host-owned-process-unavailable')
  exit 2
}
