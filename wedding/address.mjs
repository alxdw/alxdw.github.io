// Google's structured address components -> editable postal fields.
export function addressFromComponents(components) {
  if (!Array.isArray(components)) return null;
  const component = (type) => components.find((part) => Array.isArray(part?.types) && part.types.includes(type));
  const get = (type) => component(type)?.longText?.trim() || '';
  const street = [get('street_number'), get('route')].filter(Boolean).join(' ') || get('street_address');
  const premise = get('premise');
  const country = get('country');
  // A postcode, city or country prediction alone is not a postal address.
  if ((!street && !premise) || !country) return null;
  const countryCode = component('country')?.shortText?.toUpperCase();
  const extra = [get('subpremise'), street ? premise : '', get('sublocality_level_1')];
  return {
    line1: street || premise,
    line2: [...new Set(extra.filter(Boolean))].join(', '),
    city: get('postal_town') || get('locality') || get('administrative_area_level_3') || get('administrative_area_level_2'),
    region: countryCode === 'GB'
      ? get('administrative_area_level_2') || get('administrative_area_level_1')
      : get('administrative_area_level_1'),
    postcode: [get('postal_code'), get('postal_code_suffix')].filter(Boolean).join('-'),
    country,
  };
}
