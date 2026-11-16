import { Fragment } from "react";
import { useBreadcrumbs } from "../hooks/use-breadcrumbs";

export function LayoutDynamicBreadcrumb() {
  const breadcrumbs = useBreadcrumbs();

  if (breadcrumbs.length === 0) {
    return null;
  }

  return (
    <div className="flex items-center">
      {breadcrumbs.map(({ handle, params }, index) => {
        const BreadcrumbComponent = handle.breadcrumb;
        if (!BreadcrumbComponent) return null;

        return (
          <Fragment key={index}>
            <BreadcrumbComponent params={params} />
          </Fragment>
        );
      })}
    </div>
  );
}
