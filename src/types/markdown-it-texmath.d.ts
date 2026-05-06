declare module "markdown-it-texmath" {
  import type MarkdownIt from "markdown-it";

  type TexmathOptions = {
    engine: unknown;
    delimiters?: "dollars" | "brackets" | "gitlab" | "julia" | "kramdown";
    katexOptions?: Record<string, unknown>;
  };

  const texmath: MarkdownIt.PluginWithOptions<TexmathOptions>;
  export default texmath;
}
