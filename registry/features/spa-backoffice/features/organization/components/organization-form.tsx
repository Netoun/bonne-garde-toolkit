import { Link } from "react-router";
import { useForm } from "@tanstack/react-form";
import { useDebouncedCallback } from "@tanstack/react-pacer/debouncer";
import { branding } from "@acme/config";
import { Button } from "@acme/ui/components/button";
import { Input } from "@acme/ui/components/input";
import { Label } from "@acme/ui/components/label";

interface OrganizationFormProps {
  initialData?: {
    name: string;
    slug: string;
    description?: string;
    primaryColor?: string;
    secondaryColor?: string;
  };
  onSubmit: (data: {
    name: string;
    slug: string;
    description?: string;
    primaryColor?: string;
    secondaryColor?: string;
  }) => Promise<void>;
  submitLabel: string;
  isEdit?: boolean;
}

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const publicHost = new URL(branding.publicOrigin).host;

export function OrganizationForm({
  initialData,
  onSubmit,
  submitLabel,
  isEdit = false,
}: OrganizationFormProps) {
  const form = useForm({
    defaultValues: {
      name: initialData?.name ?? "",
      slug: initialData?.slug ?? "",
      description: initialData?.description ?? "",
      primaryColor: initialData?.primaryColor ?? "#3b82f6",
      secondaryColor: initialData?.secondaryColor ?? "#8b5cf6",
    },
    onSubmit: async ({ value }) => {
      await onSubmit({
        name: value.name.trim(),
        slug: value.slug.trim(),
        description: value.description.trim() || undefined,
        primaryColor: value.primaryColor,
        secondaryColor: value.secondaryColor,
      });
    },
  });

  // Debounce slug generation from name
  const slugDebouncer = useDebouncedCallback(
    (name: string) => {
      if (!isEdit) {
        form.setFieldValue("slug", generateSlug(name));
      }
    },
    { wait: 300 },
  );

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation();
        form.handleSubmit();
      }}
      className="space-y-4"
    >
      <form.Field
        name="name"
        validators={{
          onChange: ({ value }) => (!value.trim() ? "Name is required" : undefined),
        }}
      >
        {(field) => (
          <div className="space-y-2">
            <Label htmlFor={field.name}>Nom *</Label>
            <Input
              id={field.name}
              name={field.name}
              value={field.state.value}
              onChange={(e) => {
                field.handleChange(e.target.value);
                slugDebouncer(e.target.value);
              }}
              onBlur={field.handleBlur}
              placeholder="My organization"
            />
            {field.state.meta.errors.length > 0 && (
              <p className="text-sm text-destructive">{field.state.meta.errors[0]}</p>
            )}
          </div>
        )}
      </form.Field>

      <form.Field
        name="slug"
        validators={{
          onChange: ({ value }) => {
            if (!value.trim()) return "Slug is required";
            if (!/^[a-z0-9-]+$/.test(value)) {
              return "Only lowercase letters, numbers, and dashes are allowed";
            }
            return undefined;
          },
        }}
      >
        {(field) => (
          <div className="space-y-2">
            <Label htmlFor={field.name}>Slug *</Label>
            <Input
              id={field.name}
              name={field.name}
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
              onBlur={field.handleBlur}
              placeholder="mon-organisation"
            />
            <p className="text-xs text-muted-foreground">
              Utilisé dans l&apos;URL : {publicHost}/o/{field.state.value || "your-slug"}
            </p>
            {field.state.meta.errors.length > 0 && (
              <p className="text-sm text-destructive">{field.state.meta.errors[0]}</p>
            )}
          </div>
        )}
      </form.Field>

      <form.Field name="description">
        {(field) => (
          <div className="space-y-2">
            <Label htmlFor={field.name}>Description</Label>
            <Input
              id={field.name}
              name={field.name}
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
              onBlur={field.handleBlur}
              placeholder="Organization description..."
            />
          </div>
        )}
      </form.Field>

      {isEdit && (
        <div className="grid grid-cols-2 gap-4">
          <form.Field name="primaryColor">
            {(field) => (
              <div className="space-y-2">
                <Label htmlFor={field.name}>Primary color</Label>
                <div className="flex gap-2">
                  <Input
                    id={field.name}
                    name={field.name}
                    type="color"
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    onBlur={field.handleBlur}
                    className="w-12 h-10 p-1"
                  />
                  <Input
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    placeholder="#3b82f6"
                    className="flex-1"
                  />
                </div>
              </div>
            )}
          </form.Field>

          <form.Field name="secondaryColor">
            {(field) => (
              <div className="space-y-2">
                <Label htmlFor={field.name}>Secondary color</Label>
                <div className="flex gap-2">
                  <Input
                    id={field.name}
                    name={field.name}
                    type="color"
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    onBlur={field.handleBlur}
                    className="w-12 h-10 p-1"
                  />
                  <Input
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    placeholder="#8b5cf6"
                    className="flex-1"
                  />
                </div>
              </div>
            )}
          </form.Field>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Link to="/organizations">
          <Button type="button" variant="outline">
            Cancel
          </Button>
        </Link>
        <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
          {([canSubmit, isSubmitting]) => (
            <Button type="submit" disabled={!canSubmit || isSubmitting}>
              {isSubmitting ? "Saving..." : submitLabel}
            </Button>
          )}
        </form.Subscribe>
      </div>
    </form>
  );
}
