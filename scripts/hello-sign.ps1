# The Windows Hello release key (SEC-9). Never prints key material: the public key is public.
#   hello-sign.ps1 create   makes the key (Hello prompt), prints its public key (SPKI, base64)
#   hello-sign.ps1 pubkey   prints the public key, no prompt
#   hello-sign.ps1 check    prints whether the key is TPM-attested, no prompt
#   hello-sign.ps1 sign     reads the text to sign on stdin, shows the Hello prompt, prints the signature (base64)
param([Parameter(Mandatory)][ValidateSet('create', 'pubkey', 'check', 'sign')][string]$Action, [string]$Name = 'jg-release-updates')
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$KCM = [Windows.Security.Credentials.KeyCredentialManager, Windows.Security.Credentials, ContentType = WindowsRuntime]
$null = [Windows.Security.Cryptography.Core.CryptographicPublicKeyBlobType, Windows.Security.Cryptography.Core, ContentType = WindowsRuntime]
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } | Select-Object -First 1
function Await($op, [type]$t) { $asTask.MakeGenericMethod($t).Invoke($null, @($op)).GetAwaiter().GetResult() }
$Buf = [System.Runtime.InteropServices.WindowsRuntime.WindowsRuntimeBufferExtensions]
$RR = [Windows.Security.Credentials.KeyCredentialRetrievalResult]

if ($Action -eq 'create') {
  $r = Await ($KCM::RequestCreateAsync($Name, [Windows.Security.Credentials.KeyCredentialCreationOption]::FailIfExists)) $RR
} else {
  $r = Await ($KCM::OpenAsync($Name)) $RR
}
if ($r.Status -ne 'Success') { [Console]::Error.WriteLine("Hello key ${Name}: $($r.Status)"); exit 2 }
$c = $r.Credential

switch ($Action) {
  { $_ -in 'create', 'pubkey' } {
    [Convert]::ToBase64String($Buf::ToArray($c.RetrievePublicKey([Windows.Security.Cryptography.Core.CryptographicPublicKeyBlobType]::X509SubjectPublicKeyInfo)))
  }
  'check' {
    $a = Await ($c.GetAttestationAsync()) ([Windows.Security.Credentials.KeyCredentialAttestationResult])
    "attestation: $($a.Status)"  # Success means a TPM-backed key with a TPM attestation
  }
  'sign' {
    [Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
    $text = [Console]::In.ReadToEnd()
    $s = Await ($c.RequestSignAsync($Buf::AsBuffer([Text.Encoding]::UTF8.GetBytes($text)))) ([Windows.Security.Credentials.KeyCredentialOperationResult])
    if ($s.Status -ne 'Success') { [Console]::Error.WriteLine("Hello sign: $($s.Status)"); exit 3 }
    [Convert]::ToBase64String($Buf::ToArray($s.Result))
  }
}
