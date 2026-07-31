/**
 * CodeMirror-backed editor for the playground. Syntax highlighting per language,
 * theme following the app's light/dark preference, and a Ctrl/Cmd+Enter keymap
 * that triggers the run. Kept in its own module so it only loads with the
 * (lazy) playground chunk.
 */
import { cpp } from "@codemirror/lang-cpp";
import { java } from "@codemirror/lang-java";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { CodeLanguage } from "@codeapt/shared";
import CodeMirror, {
  keymap,
  type Extension,
  type KeyBinding,
} from "@uiw/react-codemirror";
import { useMemo } from "react";

import { useTheme } from "../../providers/ThemeProvider.js";

function languageExtension(language: CodeLanguage): Extension {
  switch (language) {
    case CodeLanguage.PYTHON:
      return python();
    case CodeLanguage.JAVASCRIPT:
      return javascript();
    case CodeLanguage.JAVA:
      return java();
    case CodeLanguage.CPP:
    case CodeLanguage.C:
      // CodeMirror ships one C-family mode; it highlights C well enough.
      return cpp();
  }
}

export function CodeEditor({
  value,
  language,
  onChange,
  onRun,
  disabled,
}: {
  value: string;
  language: CodeLanguage;
  onChange: (next: string) => void;
  onRun: () => void;
  disabled?: boolean;
}) {
  const { theme } = useTheme();

  const extensions = useMemo<Extension[]>(() => {
    const runKey: KeyBinding = {
      key: "Mod-Enter",
      preventDefault: true,
      run: () => {
        onRun();
        return true;
      },
    };
    return [languageExtension(language), keymap.of([runKey])];
  }, [language, onRun]);

  return (
    <CodeMirror
      value={value}
      height="100%"
      theme={theme}
      editable={!disabled}
      extensions={extensions}
      onChange={onChange}
      basicSetup={{
        lineNumbers: true,
        highlightActiveLine: true,
        highlightActiveLineGutter: true,
        foldGutter: false,
        autocompletion: false,
      }}
      className="h-full text-sm [&_.cm-editor]:h-full [&_.cm-scroller]:font-mono"
    />
  );
}
