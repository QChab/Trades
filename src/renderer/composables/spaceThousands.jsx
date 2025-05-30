const spaceThousands = (str) => {
    if (!str) return '';
  const [intPart, fracPart] = str.split('.');
  const grouped = intPart
    .replace(/\D/g, '')                          // strip any formatting
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return fracPart != null
    ? `${grouped}.${fracPart}`
    : grouped;
}

export default spaceThousands;