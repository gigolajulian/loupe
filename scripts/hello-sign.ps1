# The Windows Hello release key (SEC-9). Never prints key material: the public key is public.
#   hello-sign.ps1 create   makes the key (Hello prompt), prints its public key (SPKI, base64)
#   hello-sign.ps1 pubkey   prints the public key, no prompt
#   hello-sign.ps1 check    prints whether the key is TPM-attested, no prompt
#   hello-sign.ps1 sign     reads the text to sign on stdin, shows the Hello prompt, prints the signature (base64)
# The WinRT calls are C#, compiled here by Windows' own compiler: PowerShell 5.1 can't read the IBuffers WinRT returns.
param([Parameter(Mandatory)][ValidateSet('create', 'pubkey', 'check', 'sign')][string]$Action, [string]$Name = 'jg-release-updates')
$ErrorActionPreference = 'Stop'
$fw = [Runtime.InteropServices.RuntimeEnvironment]::GetRuntimeDirectory()
$md = Join-Path $env:SystemRoot 'System32\WinMetadata'
$src = @'
using System;
using System.Threading;
using Windows.Foundation;
using Windows.Security.Credentials;
using Windows.Security.Cryptography;
using Windows.Security.Cryptography.Core;
using Windows.Storage.Streams;
public static class HelloKey {
  // waits on a WinRT call by polling: no Windows SDK on this PC for the AsTask helpers
  static T Wait<T>(IAsyncOperation<T> op) {
    while (op.Status == AsyncStatus.Started) Thread.Sleep(20);
    if (op.Status != AsyncStatus.Completed) throw new Exception("Windows Hello call " + op.Status + (op.ErrorCode != null ? ": " + op.ErrorCode.Message : ""));
    return op.GetResults();
  }
  static string B64(IBuffer b) { byte[] a; CryptographicBuffer.CopyToByteArray(b, out a); return Convert.ToBase64String(a); }
  static KeyCredential Get(string name, bool create) {
    var r = Wait(create ? KeyCredentialManager.RequestCreateAsync(name, KeyCredentialCreationOption.FailIfExists) : KeyCredentialManager.OpenAsync(name));
    if (r.Status != KeyCredentialStatus.Success) throw new Exception("Hello key " + name + ": " + r.Status);
    return r.Credential;
  }
  public static string Pub(string name, bool create) {
    return B64(Get(name, create).RetrievePublicKey(CryptographicPublicKeyBlobType.X509SubjectPublicKeyInfo));
  }
  public static string Check(string name) {
    return Wait(Get(name, false).GetAttestationAsync()).Status.ToString();
  }
  public static string Sign(string name, byte[] data) {
    var s = Wait(Get(name, false).RequestSignAsync(CryptographicBuffer.CreateFromByteArray(data)));
    if (s.Status != KeyCredentialStatus.Success) throw new Exception("Hello sign: " + s.Status);
    return B64(s.Result);
  }
}
'@
# compiled in memory by CodeDom, which hands the .winmd references to csc without loading them into PowerShell
$cp = New-Object CodeDom.Compiler.CompilerParameters
$cp.GenerateInMemory = $true
$cp.ReferencedAssemblies.AddRange([string[]]@('System.Runtime.dll' | ForEach-Object { Join-Path $fw $_ }) +
  [string[]]@('Windows.Foundation.winmd', 'Windows.Security.winmd', 'Windows.Storage.winmd' | ForEach-Object { Join-Path $md $_ }))
$res = (New-Object Microsoft.CSharp.CSharpCodeProvider).CompileAssemblyFromSource($cp, $src)
if ($res.Errors.HasErrors) { $res.Errors | ForEach-Object { [Console]::Error.WriteLine($_.ToString()) }; exit 4 }
$HK = $res.CompiledAssembly.GetType('HelloKey')
try {
  switch ($Action) {
    'create' { $HK::Pub($Name, $true) }
    'pubkey' { $HK::Pub($Name, $false) }
    'check' { 'attestation: ' + $HK::Check($Name) }  # Success means a TPM-backed key with a TPM attestation
    'sign' {
      $ms = New-Object IO.MemoryStream; [Console]::OpenStandardInput().CopyTo($ms)  # the exact bytes, no decoding
      $HK::Sign($Name, $ms.ToArray())
    }
  }
} catch { [Console]::Error.WriteLine($_.Exception.GetBaseException().Message); exit 2 }
