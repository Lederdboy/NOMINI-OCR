param(
    [string]$InitialFolder = ""
)

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

if (-not $InitialFolder -and $env:NOMINI_INITIAL_FOLDER) {
    $InitialFolder = $env:NOMINI_INITIAL_FOLDER
}

$code = @"
using System;
using System.Runtime.InteropServices;
using System.Windows.Forms;

public static class NominiFolderPicker {
    [ComImport, Guid("DC1C5A9C-E88A-4dde-A5A1-60F82A20AEF7")]
    private class FileOpenDialogRCW {}

    [ComImport, Guid("42f85136-db7e-439c-85f1-e4075d135fc8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IFileDialog {
        [PreserveSig] int Show(IntPtr parent);
        void SetFileTypes(uint cFileTypes, IntPtr rgFilterSpec);
        void SetFileTypeIndex(uint iFileType);
        void GetFileTypeIndex(out uint piFileType);
        void Advise(IntPtr pfde, out uint pdwCookie);
        void Unadvise(uint dwCookie);
        void SetOptions(uint fos);
        void GetOptions(out uint pfos);
        void SetDefaultFolder(IShellItem psi);
        void SetFolder(IShellItem psi);
        void GetFolder(out IShellItem ppsi);
        void GetCurrentSelection(out IShellItem ppsi);
        void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string pszName);
        void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string pszName);
        void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string pszTitle);
        void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string pszText);
        void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string pszLabel);
        void GetResult(out IShellItem ppsi);
    }

    [ComImport, Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IShellItem {
        void BindToHandler(IntPtr pbc, ref Guid bhid, ref Guid riid, out IntPtr ppv);
        void GetParent(out IShellItem ppsi);
        void GetDisplayName(uint sigdnName, out IntPtr ppszName);
        void GetAttributes(uint sfgaoMask, out uint psfgaoAttribs);
        void Compare(IShellItem psi, uint hint, out int piOrder);
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
    private static extern void SHCreateItemFromParsingName(string pszPath, IntPtr pbc, ref Guid riid, out IShellItem ppv);

    [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] private static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);

    public static string Pick(string initialFolder) {
        Form owner = new Form();
        owner.TopMost = true;
        owner.ShowInTaskbar = false;
        owner.FormBorderStyle = FormBorderStyle.None;
        owner.StartPosition = FormStartPosition.CenterScreen;
        owner.Size = new System.Drawing.Size(1, 1);
        owner.Opacity = 0;
        owner.Show();

        keybd_event(0x12, 0, 0, UIntPtr.Zero);
        keybd_event(0x12, 0, 2, UIntPtr.Zero);
        SetForegroundWindow(owner.Handle);
        owner.Activate();

        IFileDialog dialog = (IFileDialog)new FileOpenDialogRCW();
        // FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM | FOS_PATHMUSTEXIST
        dialog.SetOptions(0x20 | 0x40 | 0x800);
        // Unicode escapes (\u00e1 = a con tilde, \u00ed = i con tilde) para evitar problemas de codificacion en PowerShell 5.1
        dialog.SetTitle("Guardar Como - Selecciona la carpeta donde se guardar\u00e1n los PDFs");
        dialog.SetOkButtonLabel("Guardar aqu\u00ed");

        if (!string.IsNullOrEmpty(initialFolder) && System.IO.Directory.Exists(initialFolder)) {
            try {
                Guid iid = typeof(IShellItem).GUID;
                IShellItem folder;
                SHCreateItemFromParsingName(initialFolder, IntPtr.Zero, ref iid, out folder);
                dialog.SetFolder(folder);
            } catch {}
        }

        string result = null;
        int hr = dialog.Show(owner.Handle);
        if (hr == 0) {
            IShellItem item;
            dialog.GetResult(out item);
            IntPtr pszPath;
            item.GetDisplayName(0x80058000, out pszPath); // SIGDN_FILESYSPATH
            result = Marshal.PtrToStringUni(pszPath);
            Marshal.FreeCoTaskMem(pszPath);
        }

        owner.Close();
        owner.Dispose();
        return result;
    }
}
"@

Add-Type -TypeDefinition $code -ReferencedAssemblies System.Windows.Forms, System.Drawing

$picked = [NominiFolderPicker]::Pick($InitialFolder)
if ($picked) {
    [Console]::Out.WriteLine($picked)
}
