import { CompaniesClient } from '@/components/CompaniesClient';
import { writesEnabled } from '@/lib/auth';
import { repo } from '@/lib/server';

export const dynamic = 'force-dynamic';

export default async function Companies() {
  const companies = await repo().listCompanies();
  return (
    <>
      <h1>Companies</h1>
      <p className="sub">Set eligibility, relationship and contact once. Cards read from here. A company that is not on this list shows Unknown for Section 135.</p>
      <CompaniesClient companies={companies.sort((a, b) => a.name.localeCompare(b.name))} writable={writesEnabled()} />
    </>
  );
}
