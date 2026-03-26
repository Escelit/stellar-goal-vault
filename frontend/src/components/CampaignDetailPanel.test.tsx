import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CampaignDetailPanel } from './CampaignDetailPanel';
import { Campaign } from '../types/campaign';

const mockCampaign: Campaign = {
  id: 'camp-1',
  title: 'Test Campaign',
  description: 'A test campaign description',
  creator: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ012345678901234567890123456789',
  assetCode: 'USDC',
  pledges: [],
  progress: {
    remainingAmount: 100,
    pledgeCount: 0,
    canPledge: true,
    canClaim: false,
    canRefund: false,
  },
  metadata: {},
};

describe('CampaignDetailPanel', () => {
  it('shows empty state when no campaign selected', () => {
    render(
      <CampaignDetailPanel
        campaign={null}
        onPledge={async () => {}}
        onClaim={async () => {}}
        onRefund={async () => {}}
      />
    );
    expect(screen.getByText(/Pick a campaign/i)).toBeInTheDocument();
  });

  it('renders campaign details when campaign is selected', () => {
    render(
      <CampaignDetailPanel
        campaign={mockCampaign}
        onPledge={async () => {}}
        onClaim={async () => {}}
        onRefund={async () => {}}
      />
    );
    expect(screen.getByText('Test Campaign')).toBeInTheDocument();
    expect(screen.getByText('USDC')).toBeInTheDocument();
  });

  it('shows error message when actionError is passed', () => {
    render(
      <CampaignDetailPanel
        campaign={mockCampaign}
        actionError="Pledge failed"
        onPledge={async () => {}}
        onClaim={async () => {}}
        onRefund={async () => {}}
      />
    );
    expect(screen.getByText('Pledge failed')).toBeInTheDocument();
  });

  it('shows success message when actionMessage is passed', () => {
    render(
      <CampaignDetailPanel
        campaign={mockCampaign}
        actionMessage="Pledge successful"
        onPledge={async () => {}}
        onClaim={async () => {}}
        onRefund={async () => {}}
      />
    );
    expect(screen.getByText('Pledge successful')).toBeInTheDocument();
  });

  it('calls onPledge when form is submitted', async () => {
    const user = userEvent.setup();
    const onPledge = vi.fn().mockResolvedValue(undefined);

    render(
      <CampaignDetailPanel
        campaign={mockCampaign}
        onPledge={onPledge}
        onClaim={async () => {}}
        onRefund={async () => {}}
      />
    );

    await user.type(screen.getByPlaceholderText(/G\.\.\. contributor public key/i), 'GTEST123');
    await user.click(screen.getByText('Add pledge'));
    expect(onPledge).toHaveBeenCalled();
  });
});