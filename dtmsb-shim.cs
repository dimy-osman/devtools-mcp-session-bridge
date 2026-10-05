using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text;
using Microsoft.Win32;

/// <summary>
/// DTMSB launch shim. Registered as the IFEO debugger for brave.exe and chrome.exe.
/// Normal launches get an internal DevTools port. The public attach port stays with session-gate.cjs.
/// </summary>
public class DtmSbShim {
  const string IfeoRoot = @"Software\Microsoft\Windows NT\CurrentVersion\Image File Execution Options\";

  static string InternalPortFor(string target) {
    string name = Path.GetFileName(target).ToLowerInvariant();
    if (name == "chrome.exe") return "--remote-debugging-port=47224";
    return "--remote-debugging-port=47223";
  }

  static bool IsBlockedPort(string arg) {
    return arg == "--remote-debugging-port=9222"
      || arg == "--remote-debugging-port=9223"
      || arg == "--remote-debugging-port=9224";
  }

  static void EnsureGate() {
    try {
      string root = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
      string gate = Path.Combine(root, "session-gate.cjs");
      if (!File.Exists(gate)) return;
      string node = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "Programs", "node", "node.exe");
      if (!File.Exists(node)) node = "node";
      var gatePsi = new ProcessStartInfo();
      gatePsi.FileName = node;
      gatePsi.Arguments = "\"" + gate + "\"";
      gatePsi.UseShellExecute = false;
      gatePsi.CreateNoWindow = true;
      Process.Start(gatePsi);
    } catch (Exception ex) {
      Log("gate " + ex.Message);
    }
  }

  static void Log(string msg) {
    try {
      string path = Path.Combine(Path.GetTempPath(), "dtmsb-shim.log");
      File.AppendAllText(path, DateTime.Now.ToString("s") + " " + msg + Environment.NewLine);
    } catch { }
  }

  public static int Main(string[] args) {
    if (args == null || args.Length < 1) {
      Console.Error.WriteLine("dtmsb-shim: missing target executable");
      return 1;
    }

    string target = args[0];
    string ifeoKey = IfeoRoot + Path.GetFileName(target);
    bool isHelper = false;
    for (int i = 1; i < args.Length; i++) {
      if (args[i].StartsWith("--type=", StringComparison.Ordinal)) {
        isHelper = true;
        break;
      }
    }

    var finalArgs = new List<string>();
    if (isHelper) {
      for (int i = 1; i < args.Length; i++) finalArgs.Add(args[i]);
    } else {
      bool sawPort = false;
      for (int i = 1; i < args.Length; i++) {
        string a = args[i];
        if (a.StartsWith("--remote-debugging-port=", StringComparison.Ordinal)) {
          if (IsBlockedPort(a)) {
            Log("strip " + a + " (public port belongs to the session gate)");
            continue;
          }
          if (!sawPort) {
            finalArgs.Add(a);
            sawPort = true;
          }
        } else {
          finalArgs.Add(a);
        }
      }
      if (!sawPort) finalArgs.Insert(0, InternalPortFor(target));
      Log("launch target=" + target + " args=" + QuoteArgs(finalArgs));
      EnsureGate();
    }

    var psi = new ProcessStartInfo();
    psi.FileName = target;
    psi.UseShellExecute = false;
    psi.Arguments = QuoteArgs(finalArgs);

    object savedDebugger = null;
    RegistryKey key = null;
    try {
      key = Registry.CurrentUser.OpenSubKey(ifeoKey, true);
      if (key != null) {
        savedDebugger = key.GetValue("Debugger");
        if (savedDebugger != null) key.DeleteValue("Debugger", false);
      }
      using (Process.Start(psi)) {
        return 0;
      }
    } catch (Exception ex) {
      Log("FAIL " + ex.Message);
      Console.Error.WriteLine("dtmsb-shim failed: " + ex.Message);
      return 1;
    } finally {
      try {
        if (key != null && savedDebugger != null) {
          key.SetValue("Debugger", savedDebugger, RegistryValueKind.String);
        }
      } catch (Exception rex) {
        Log("WARN restore Debugger failed: " + rex.Message);
      }
      if (key != null) key.Close();
    }
  }

  static string QuoteArgs(List<string> list) {
    var sb = new StringBuilder();
    for (int i = 0; i < list.Count; i++) {
      if (i > 0) sb.Append(' ');
      sb.Append(Quote(list[i]));
    }
    return sb.ToString();
  }

  static string Quote(string arg) {
    if (arg == null || arg.Length == 0) return "\"\"";
    bool need = false;
    for (int i = 0; i < arg.Length; i++) {
      char c = arg[i];
      if (c == ' ' || c == '\t' || c == '"' || c == '\n' || c == '\v') { need = true; break; }
    }
    if (!need) return arg;
    var sb = new StringBuilder();
    sb.Append('"');
    int bs = 0;
    for (int i = 0; i < arg.Length; i++) {
      char c = arg[i];
      if (c == '\\') { bs++; continue; }
      if (c == '"') {
        sb.Append(new string('\\', bs * 2 + 1));
        sb.Append('"');
        bs = 0;
        continue;
      }
      if (bs > 0) { sb.Append(new string('\\', bs)); bs = 0; }
      sb.Append(c);
    }
    if (bs > 0) sb.Append(new string('\\', bs * 2));
    sb.Append('"');
    return sb.ToString();
  }
}
