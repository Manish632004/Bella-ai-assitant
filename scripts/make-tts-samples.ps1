Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)

function Say($voice, $rate, $pitch, $out) {
  $synth.SelectVoice($voice)
  $synth.Rate = $rate
  $synth.SpeakAsyncCancelAll()
  $synth.SetOutputToWaveFile($out, $fmt)
  # pitch via SSML for variety
  $ssml = "<?xml version='1.0'?><speak version='1.0' xml:lang='en-US' xmlns='http://www.w3.org/2001/10/synthesis'><prosody pitch='$pitch'><break time='150ms'/> Hey Bella </prosody></speak>"
  $synth.SpeakSsml($ssml)
  $synth.SetOutputToNull()
}

# OWNER enrollment takes (Zira, varied)
Say "Microsoft Zira Desktop" -1 "+0Hz"  "$env:TEMP\opencode\own1.wav"
Say "Microsoft Zira Desktop"  0 "-30Hz" "$env:TEMP\opencode\own2.wav"
Say "Microsoft Zira Desktop"  1 "+25Hz" "$env:TEMP\opencode\own3.wav"
# fresh owner test take
Say "Microsoft Zira Desktop"  0 "+5Hz"  "$env:TEMP\opencode\own_test.wav"
# IMPOSTOR (David)
Say "Microsoft David Desktop" 0 "+0Hz"  "$env:TEMP\opencode\imp.wav"

Get-ChildItem "$env:TEMP\opencode\*.wav" | Where-Object { $_.Name -match '^(own|imp)' } | Select-Object Name, Length
