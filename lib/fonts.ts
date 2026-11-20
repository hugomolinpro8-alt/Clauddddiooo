import { Anton, Fraunces, Inter } from "next/font/google";

export const anton = Anton({ subsets: ["latin"], weight: "400", variable: "--font-anton", display: "swap" });
export const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
export const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  display: "swap",
  style: ["normal", "italic"],
  axes: ["opsz"],
});
