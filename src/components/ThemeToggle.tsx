"use client";
import { Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";
import { Button } from "@/components/ui";

// El estado de tema vive en <html>; así cualquier control observa el mismo valor.
function subscribeTheme(onChange: () => void) {
  const notify = () => onChange();
  const syncStorage = (event: StorageEvent) => {
    if (event.key !== "theme") return;
    document.documentElement.classList.toggle("dark", event.newValue === "dark");
    notify();
  };
  window.addEventListener("sonora:theme", notify);
  window.addEventListener("storage", syncStorage);
  return () => {
    window.removeEventListener("sonora:theme", notify);
    window.removeEventListener("storage", syncStorage);
  };
}

const getTheme = () => document.documentElement.classList.contains("dark");
const getServerTheme = () => false;

export function useTheme() {
  const dark = useSyncExternalStore(subscribeTheme, getTheme, getServerTheme);
  const set = (value: boolean) => {
    document.documentElement.classList.toggle("dark", value);
    localStorage.setItem("theme", value ? "dark" : "light");
    window.dispatchEvent(new Event("sonora:theme"));
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
