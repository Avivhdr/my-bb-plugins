import { FILE_ICON_SVGS, type FileIconName } from "./svgs";

export function FileTypeIcon({ name }: { name: FileIconName }) {
  return (
    <span
      aria-hidden
      data-icon={name}
      className="inline-flex size-4 shrink-0 [&>svg]:size-full"
      dangerouslySetInnerHTML={{ __html: FILE_ICON_SVGS[name] }}
    />
  );
}
