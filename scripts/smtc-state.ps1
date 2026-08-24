Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]

function Await-WinRt($asyncOp, $resultType) {
  $asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
    $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
  })[0]
  $netTask = $asTask.MakeGenericMethod($resultType).Invoke($null, @($asyncOp))
  $netTask.Wait(-1) | Out-Null
  return $netTask.Result
}

$mgrType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]
$mgr = Await-WinRt ($mgrType::RequestAsync()) $mgrType

$sessions = @($mgr.GetSessions())
Write-Output ("sessions={0}" -f $sessions.Count)
foreach ($s in $sessions) {
  $props = Await-WinRt ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
  Write-Output ("{0} | {1} | '{2}' by '{3}'" -f $s.SourceAppUserModelId, $s.GetPlaybackInfo().PlaybackStatus, $props.Title, $props.Artist)
}
