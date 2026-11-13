"use client";
import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui";

export function useTheme() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);
  const set = (d: boolean) => {
    document.documentElement.classList.toggle("dark", d);
    localStorage.setItem("theme", d ? "dark" : "light");
    setDark(d);
  };
  return { dark, set };
}

export function ThemeToggle() {
  const { dark, set } = useTheme();
  return (
    <Button variant="ghost" size="icon" onClick={() => set(!dark)} aria-label={dark ? "Cambiar a modo claro" : "Cambiar a modo oscuro"} title="Cambiar tema">
      {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  );
}
