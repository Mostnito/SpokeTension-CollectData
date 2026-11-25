export default function CountryFlag({ country }) {
  let flag;

  if (country === "th") {
    flag = <>
      <path fill="#a51931" d="M0 0h30v20H0z" />
      <path fill="#f4f5f8" d="M0 3.333h30v13.334H0z" />
      <path fill="#2d2a4a" d="M0 6.667h30v6.666H0z" />
    </>;
  } else if (country === "us") {
    const star = Array.from({ length: 10 }, (_, index) => {
      const angle = index * Math.PI / 5 - Math.PI / 2;
      const radius = index % 2 ? 0.2 : 0.46;
      return `${Math.cos(angle) * radius},${Math.sin(angle) * radius}`;
    }).join(" ");
    flag = <>
      <path fill="#b22234" d="M0 0h30v20H0z" />
      {Array.from({ length: 6 }, (_, index) => <rect key={index} y={(index * 2 + 1) * 20 / 13} width="30" height={20 / 13} fill="#fff" />)}
      <path fill="#3c3b6e" d="M0 0h12v10.76923H0z" />
      <g fill="#fff">
        {Array.from({ length: 9 }, (_, row) => Array.from({ length: row % 2 ? 5 : 6 }, (_, column) => <polygon key={`${row}-${column}`} points={star} transform={`translate(${(row % 2 ? 2 : 1) + column * 2} ${(row + 1) * 14 / 13})`} />))}
      </g>
    </>;
  } else if (country === "tw") {
    flag = <>
      <path fill="#fe0000" d="M0 0h30v20H0z" />
      <path fill="#000095" d="M0 0h15v10H0z" />
      <g fill="#fff">
        {Array.from({ length: 12 }, (_, index) => <path key={index} d="M7.5 1.25 8.02 3.12H6.98Z" transform={`rotate(${index * 30} 7.5 5)`} />)}
        <circle cx="7.5" cy="5" r="1.875" />
      </g>
    </>;
  } else {
    return null;
  }

  return <svg viewBox="0 0 30 20" aria-hidden="true" focusable="false">{flag}</svg>;
}
