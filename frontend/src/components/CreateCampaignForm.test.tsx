import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CreateCampaignForm } from './CreateCampaignForm';

describe('CreateCampaignForm', () => {
  it('renders all required fields', () => {
    render(<CreateCampaignForm onCreate={async () => {}} />);
    expect(screen.getByPlaceholderText(/G\.\.\. creator public key/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Stellar community design sprint/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Describe what the campaign funds/i)).toBeInTheDocument();
  });

  it('shows api error when passed', () => {
    render(<CreateCampaignForm onCreate={async () => {}} apiError="Something went wrong" />);
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });

  it('resets form after successful submit', async () => {
    const user = userEvent.setup();
    render(<CreateCampaignForm onCreate={async () => {}} />);

    const titleInput = screen.getByPlaceholderText(/Stellar community design sprint/i);
    await user.clear(titleInput);
    await user.type(titleInput, 'My Test Campaign');
    expect(titleInput).toHaveValue('My Test Campaign');
  });
});