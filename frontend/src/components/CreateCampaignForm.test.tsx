import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CreateCampaignForm } from "./CreateCampaignForm";

describe("CreateCampaignForm", () => {
  it("renders all required fields", () => {
    render(<CreateCampaignForm onCreate={async () => {}} />);
    expect(
      screen.getByPlaceholderText(/G\.\.\. creator public key/i),
    ).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText(/Stellar community design sprint/i),
    ).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText(/Describe what the campaign funds/i),
    ).toBeInTheDocument();
  });

  it("shows api error when passed", () => {
    render(
      <CreateCampaignForm
        onCreate={async () => {}}
        apiError={{ message: "Something went wrong" }}
      />,
    );
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
  });

  it("resets form after successful submit", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn().mockResolvedValue(undefined);

    render(
      <CreateCampaignForm
        onCreate={onCreate}
        allowedAssets={["ARS", "USDC"]}
      />,
    );

    await user.type(
      screen.getByPlaceholderText(/G\.\.\. creator public key/i),
      `G${"A".repeat(55)}`,
    );
    await user.type(screen.getByPlaceholderText(/Stellar community design sprint/i), "My Test Campaign");
    await user.type(
      screen.getByPlaceholderText(/Describe what the campaign funds/i),
      "This campaign funds a real Soroban pledge flow for the MVP dashboard.",
    );
    await user.click(screen.getByText("USDC"));
    await user.click(screen.getByRole("button", { name: /create campaign/i }));

    const titleInput = screen.getByPlaceholderText(
      /Stellar community design sprint/i,
    );
    await user.clear(titleInput);
    await user.type(titleInput, "My Test Campaign");
    expect(titleInput).toHaveValue("My Test Campaign");
  });
});
