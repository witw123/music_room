import { FavoriteAlbumsPage } from "@/components/FavoriteAlbumsPage";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function FavoritesPage() {
  return <FavoriteAlbumsPage />;
}
