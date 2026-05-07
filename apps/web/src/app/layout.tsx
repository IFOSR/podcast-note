export const metadata = {
  title: "Podcast Note",
  description: "Podcast intelligence inbox for watched topics."
};

export default function RootLayout({ children }: { children: unknown }) {
  return `<!doctype html><html lang="en"><body>${String(children ?? "")}</body></html>`;
}
