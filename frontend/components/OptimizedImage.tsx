"use client";

import Image, { type ImageProps, getImageProps } from "next/image";
import { useMemo } from "react";

type OptimizedImageProps = Omit<ImageProps, "placeholder" | "loading" | "sizes"> & {
  blurDataURL?: string;
  sizes?: string;
  priority?: boolean;
  quality?: number;
};

const DEVICE_SIZES = [640, 750, 828, 1080, 1200, 1920, 2048, 3840];

export function OptimizedImage({
  blurDataURL,
  priority = false,
  quality = 85,
  sizes,
  style,
  ...props
}: OptimizedImageProps) {
  const resolvedSizes = sizes ?? getResponsiveSizes(props.fill ?? false);

  const defaultBlurDataURL = useMemo(() => {
    if (blurDataURL) return blurDataURL;
    return generatePlaceholder(props.src);
  }, [blurDataURL, props.src]);

  return (
    <Image
      {...props}
      sizes={resolvedSizes}
      quality={quality}
      priority={priority}
      loading={priority ? undefined : "lazy"}
      placeholder={defaultBlurDataURL ? "blur" : "empty"}
      blurDataURL={defaultBlurDataURL || undefined}
      style={{
        maxWidth: "100%",
        height: "auto",
        ...style,
      }}
    />
  );
}

function getResponsiveSizes(fill: boolean): string {
  if (fill) {
    return "(max-width: 640px) 100vw, (max-width: 768px) 50vw, (max-width: 1024px) 33vw, 25vw";
  }
  return "(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw";
}

function generatePlaceholder(src: ImageProps["src"]): string {
  if (typeof src === "string") {
    const srcStr = src;
    if (srcStr.startsWith("data:") || srcStr.startsWith("blob:")) return "";
    if (srcStr.endsWith(".svg")) return "";
  }
  return "";
}

export function getOptimizedImageProps(props: ImageProps) {
  return getImageProps(props);
}
