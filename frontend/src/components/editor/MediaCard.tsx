"use client";

import { Heart, Play } from "lucide-react";
import type { StudioAsset } from "@/lib/studioAssets";

type MediaCardProps = {
  asset: StudioAsset;
  busy?: boolean;
  onOpen: (id: string) => void;
  onFavorite: (id: string) => void;
};

export default function MediaCard({
  asset,
  busy,
  onOpen,
  onFavorite,
}: MediaCardProps) {
  const isVideo = asset.kind === "video";
  const empty = asset.role === "empty";
  const pending = asset.momentStatus === "pending";

  return (
    <article
      className={`tile tile--${asset.skin}${empty ? " is-empty" : ""}${
        busy && asset.role === "source" ? " is-busy" : ""
      }${pending ? " is-pending" : ""}`}
    >
      <span className="tile__art" aria-hidden="true" />
      <span className="tile__string tile__string--a" aria-hidden="true" />
      <span className="tile__string tile__string--b" aria-hidden="true" />
      {asset.skin === 3 || asset.skin === 7 ? (
        <span className="tile__stamp" aria-hidden="true">
          {asset.skin === 7 ? "Incident no. 13" : "Item no. 12"}
        </span>
      ) : asset.skin === 2 ||
        asset.skin === 4 ||
        asset.skin === 5 ||
        asset.skin === 6 ? (
        <span className="tile__stamp" aria-hidden="true">
          Counting system
        </span>
      ) : null}
      <span className="tile__mark" aria-hidden="true">
        {asset.skin === 3 ? <strong>12</strong> : null}
        {asset.skin === 7 ? <strong>13</strong> : null}
        {asset.skin === 9 ? <strong>5.24</strong> : null}
      </span>
      <span className="tile__meta">
        <strong>{asset.title}</strong>
        <span>{asset.kicker}</span>
      </span>
      <button
        type="button"
        className="tile__hit"
        onClick={() => onOpen(asset.id)}
        aria-label={`${asset.title}. ${asset.kicker}`}
      />

      {isVideo && !empty ? (
        <span className="tile__play" aria-hidden="true">
          <Play />
        </span>
      ) : null}

      {!empty ? (
        <button
          type="button"
          className={asset.favorite ? "tile__heart is-on" : "tile__heart"}
          aria-label={
            asset.favorite
              ? `Remove ${asset.title} from favorites`
              : `Add ${asset.title} to favorites`
          }
          aria-pressed={asset.favorite}
          onClick={(event) => {
            event.stopPropagation();
            onFavorite(asset.id);
          }}
        >
          <Heart fill={asset.favorite ? "currentColor" : "none"} />
        </button>
      ) : null}
    </article>
  );
}
