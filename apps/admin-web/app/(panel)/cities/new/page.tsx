import { PageHeader } from "@/components/page-header";

import { createCity } from "../actions";
import { CityForm } from "../city-form";

export default function NewCityPage() {
  return (
    <>
      <PageHeader title="Nueva ciudad" />
      <CityForm action={createCity} />
    </>
  );
}
