using System;
using System.IO;
using System.Management;
using System.Net.Sockets;
using System.Text;
using System.Threading;

/// <summary>
/// DTMSB native messaging host. The toolbar calls this when the session gate
/// is not listening, so Restart browser can start the gate and then reboot.
/// </summary>
public class DtmSbNative {
  const int ControlPort = 9334;

  static string RootDir() {
    return AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
  }

  static void Log(string msg) {
    try {
      string path = Path.Combine(Path.GetTempPath(), "dtmsb-native.log");
      File.AppendAllText(path, DateTime.Now.ToString("s") + " " + msg + Environment.NewLine);
    } catch { }
  }

  static string ReadMessage() {
    Stream stdin = Console.OpenStandardInput();
    byte[] lenBuf = new byte[4];
    int got = 0;
    while (got < 4) {
      int n = stdin.Read(lenBuf, got, 4 - got);
      if (n <= 0) return null;
      got += n;
    }
    int len = BitConverter.ToInt32(lenBuf, 0);
    if (len <= 0 || len > 1024 * 1024) return null;
    byte[] body = new byte[len];
    got = 0;
    while (got < len) {
      int n = stdin.Read(body, got, len - got);
      if (n <= 0) return null;
      got += n;
    }
    return Encoding.UTF8.GetString(body);
  }

  static void WriteMessage(string json) {
    byte[] body = Encoding.UTF8.GetBytes(json);
    byte[] len = BitConverter.GetBytes(body.Length);
    Stream stdout = Console.OpenStandardOutput();
    stdout.Write(len, 0, 4);
    stdout.Write(body, 0, body.Length);
    stdout.Flush();
  }

  static string Field(string json, string name) {
    string needle = "\"" + name + "\"";
    int i = json.IndexOf(needle, StringComparison.Ordinal);
    if (i < 0) return "";
    int colon = json.IndexOf(':', i + needle.Length);
    if (colon < 0) return "";
    int q1 = json.IndexOf('"', colon + 1);
    if (q1 < 0) return "";
    int q2 = json.IndexOf('"', q1 + 1);
    if (q2 < 0) return "";
    return json.Substring(q1 + 1, q2 - q1 - 1);
  }

  static string Quote(string arg) {
    if (arg.IndexOf(' ') < 0 && arg.IndexOf('\t') < 0 && arg.IndexOf('"') < 0) return arg;
    return "\"" + arg + "\"";
  }

  static bool PortOpen() {
    try {
      using (var client = new TcpClient()) {
        IAsyncResult wait = client.BeginConnect("127.0.0.1", ControlPort, null, null);
        if (!wait.AsyncWaitHandle.WaitOne(300)) return false;
        client.EndConnect(wait);
        return true;
      }
    } catch {
      return false;
    }
  }

  static int StartDetached(string commandLine) {
    try {
      var scope = new ManagementScope(@"\\.\root\cimv2");
      scope.Connect();
      var cls = new ManagementClass(scope, new ManagementPath("Win32_Process"), null);
      ManagementBaseObject input = cls.GetMethodParameters("Create");
      input["CommandLine"] = commandLine;
      ManagementBaseObject output = cls.InvokeMethod("Create", input, null);
      return Convert.ToInt32(output["ReturnValue"]);
    } catch (Exception ex) {
      Log("start " + ex.Message);
      return -1;
    }
  }

  static bool EnsureGate() {
    if (PortOpen()) return false;
    string gate = Path.Combine(RootDir(), "session-gate.cjs");
    if (!File.Exists(gate)) {
      Log("missing " + gate);
      return false;
    }
    string node = Path.Combine(
      Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
      "Programs", "node", "node.exe");
    if (!File.Exists(node)) node = "node";
    string command = Quote(node) + " " + Quote(gate);
    int code = StartDetached(command);
    Log("ensure code=" + code + " cmd=" + command);
    for (int i = 0; i < 20; i++) {
      if (PortOpen()) return true;
      Thread.Sleep(150);
    }
    return PortOpen();
  }

  public static int Main(string[] args) {
    try {
      string raw = ReadMessage();
      if (raw == null) {
        WriteMessage("{\"ok\":false,\"error\":\"empty\"}");
        return 1;
      }
      if (Field(raw, "action") != "ensure") {
        WriteMessage("{\"ok\":false,\"error\":\"unknown action\"}");
        return 1;
      }
      bool started = EnsureGate();
      if (!PortOpen()) {
        WriteMessage("{\"ok\":false,\"error\":\"switch did not start\"}");
        return 1;
      }
      WriteMessage(started ? "{\"ok\":true,\"started\":true}" : "{\"ok\":true,\"started\":false}");
      return 0;
    } catch (Exception ex) {
      Log("host " + ex.Message);
      try { WriteMessage("{\"ok\":false,\"error\":\"host failed\"}"); } catch { }
      return 1;
    }
  }
}
