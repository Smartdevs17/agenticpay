import Image, { type ImageProps } from "next/image";

type OptimizedImageProps = Omit<ImageProps, "placeholder"> & {
  blurDataURL?: string;
};

export function OptimizedImage({ blurDataURL, loading, ...props }: OptimizedImageProps) {
  return (
    <Image
      {...props}
      loading={loading ?? "lazy"}
      placeholder={blurDataURL ? "blur" : "empty"}
      blurDataURL={blurDataURL}
    />
  );
}

