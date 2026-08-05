import { APP_NAME, WORKSPACE_PACKAGES } from "../lib/app-info";

export default function HomePage() {
  return (
    <main>
      <h1>{APP_NAME}</h1>
      <p>Monorepo scaffold in place. Product features arrive task by task.</p>
      <ul>
        {WORKSPACE_PACKAGES.map((name) => (
          <li key={name}>{name}</li>
        ))}
      </ul>
    </main>
  );
}
