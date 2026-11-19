// Collection presentation stays independent from capture and persistence.
const collator = new Intl.Collator('pt-BR', {sensitivity:'base', numeric:true});
const searchText = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').trim();

export function filterAndSortScans(scans, {query = '', sort = 'newest'} = {}) {
  const needle = searchText(query);
  const visible = (Array.isArray(scans) ? scans : []).filter(scan =>
    scan && typeof scan === 'object' && (!needle || searchText(scan.name || 'Objeto sem nome').includes(needle)));
  const timestamp = scan => { const value = Date.parse(scan.created_at); return Number.isFinite(value) ? value : 0; };
  return visible.sort((a, b) => {
    if (sort === 'name') return collator.compare(a.name || 'Objeto sem nome', b.name || 'Objeto sem nome') || collator.compare(a.id || '', b.id || '');
    const difference = timestamp(a) - timestamp(b);
    return (sort === 'oldest' ? difference : -difference) || collator.compare(a.id || '', b.id || '');
  });
}
