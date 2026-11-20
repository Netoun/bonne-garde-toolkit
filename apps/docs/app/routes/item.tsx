import { useLoaderData, type LoaderFunctionArgs } from "react-router";

import { ItemPage } from "../components/item/item-page";
import { loadItemPageData } from "../lib/item-page-data";
import type { Route } from "./+types/item";

export const meta: Route.MetaFunction = ({ loaderData }) => {
  if (!loaderData) return [{ title: "Bonne Garde" }];
  return [
    { title: `${loaderData.title} · Bonne Garde` },
    ...(loaderData.description ? [{ name: "description", content: loaderData.description }] : []),
  ];
};

export function loader(args: LoaderFunctionArgs) {
  return loadItemPageData(args);
}

export default function ItemRoute() {
  const data = useLoaderData<typeof loader>();
  return <ItemPage {...data} />;
}
