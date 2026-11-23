import { NotImplemented } from '../../ui/controls';
import { PanelShell } from './shared';

/** Features that depend on external services. They are described here rather than faked. */

export function PhotosPanel() {
  return (
    <PanelShell title="Photos">
      <NotImplemented title="Stock photo search">
        <p>Searching a stock library needs a provider API (for example Unsplash or Pexels) and an API key held on a server.</p>
        <p>Until that integration exists, add your own pictures from the Uploads tab.</p>
      </NotImplemented>
    </PanelShell>
  );
}
