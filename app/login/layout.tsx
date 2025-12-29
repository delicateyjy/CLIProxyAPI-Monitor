import type { Metadata } from "next";
import "../globals.css";

export const metadata: Metadata = {
  title: "登录 - CLIProxy Dashboard",
  description: "Login to CLIProxy Usage Dashboard"
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
