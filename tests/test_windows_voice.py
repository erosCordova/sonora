"""Prueba la síntesis SAPI real cuando hay voces de Windows disponibles."""
import subprocess
import sys
import tempfile
import unittest
import wave
from pathlib import Path

from comfyui_bridge.video_worker import windows_voice


@unittest.skipUnless(sys.platform == "win32", "Requiere las voces SAPI de Windows")
class WindowsVoiceTests(unittest.TestCase):
    def test_two_dialogue_lines_generate_real_audio_with_timing(self):
        probe = subprocess.run([
            "powershell.exe", "-NoProfile", "-NonInteractive", "-Command",
            "Add-Type -AssemblyName System.Speech; "
            "$s=New-Object System.Speech.Synthesis.SpeechSynthesizer; "
            "@($s.GetInstalledVoices()).Count; $s.Dispose()",
        ], capture_output=True, text=True, timeout=30)
        if probe.returncode != 0:
            self.fail("No se pudo consultar el sintetizador de Windows")
        try:
            count = int(probe.stdout.strip().splitlines()[-1])
        except (IndexError, ValueError):
            self.fail("Windows no informó cuántas voces están instaladas")
        if not count:
            self.skipTest("Este equipo de prueba no tiene voces de Windows instaladas")
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "dialogo.wav"
            timeline = windows_voice("Luna: Hola, ¿estás lista?\nSol: Sí, vamos juntos.", output,
                                     multi_voice=True, max_seconds=15)
            self.assertEqual([line["speaker"] for line in timeline], ["Luna", "Sol"])
            self.assertGreater(timeline[0]["end"], timeline[0]["start"])
            self.assertGreater(timeline[1]["start"], timeline[0]["end"])
            with wave.open(str(output), "rb") as result:
                self.assertGreater(result.getnframes(), result.getframerate())


if __name__ == "__main__":
    unittest.main()
