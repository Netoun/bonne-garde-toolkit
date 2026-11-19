import { useLoaderData, type LoaderFunctionArgs } from "react-router";

import { ItemPage } from "../components/item/item-page";
import { loadItemPageData } from "../lib/item-page-data";

export function loader(args: LoaderFunctionArgs) {
  return loadItemPageData(args);
}

export default function ItemRoute() {
  const data = useLoaderData<typeof loader>();
  return <ItemPage {...data} />;
}
