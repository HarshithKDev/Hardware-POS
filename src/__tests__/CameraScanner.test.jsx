import { render, screen, fireEvent, act } from '@testing-library/react';

const h = vi.hoisted(() => ({ instances: [], startError: null, cameras: [], panelProps: null }));

vi.mock('html5-qrcode', () => ({
  Html5Qrcode: class {
    constructor(id) { this.id = id; h.instances.push(this); }
    async start(camera, config, onDecoded) {
      if (h.startError) throw h.startError;
      this.onDecoded = onDecoded;
    }
    getState() { return 2; }
    async stop() {}
    clear() {}
    static async getCameras() { return h.cameras; }
  },
  Html5QrcodeSupportedFormats: { CODE_128: 0, EAN_13: 1, UPC_A: 2 },
}));
vi.mock('../services/audio', () => ({ playScanSuccessSound: vi.fn() }));

import InlineContinuousScanner from '../components/scanner/InlineContinuousScanner';

describe('InlineContinuousScanner', () => {
  beforeEach(() => { h.instances = []; h.startError = null; h.cameras = []; vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] }); vi.setSystemTime(0); });
  afterEach(() => { vi.useRealTimers(); });

  const decode = async (code) => { await act(async () => { await h.instances.at(-1).onDecoded(code); }); };
  const wait = async (ms) => { await act(async () => { vi.advanceTimersByTime(ms); }); };

  it('adds a held barcode once, and again only after it has been out of view', async () => {
    const onScan = vi.fn();
    const { rerender } = render(<InlineContinuousScanner readerId="t1" onScan={onScan} playSound={false} sameCodeCooldownMs={1200} />);
    await act(async () => {});

    await decode('1223');
    expect(onScan).toHaveBeenCalledTimes(1);

    // Camera still on the same label: ignored, however long it is held
    await wait(900); await decode('1223');
    await wait(1000); await decode('1223');
    expect(onScan).toHaveBeenCalledTimes(1);

    // Moved away for longer than the cooldown, then back: counts again
    await wait(1300); await decode('1223');
    expect(onScan).toHaveBeenCalledTimes(2);

    // A different barcode counts straight away (once the previous one is processed)
    await wait(900); await decode('3001');
    expect(onScan).toHaveBeenLastCalledWith('3001');

    // Paused (a popup is open): scans are ignored
    rerender(<InlineContinuousScanner readerId="t1" onScan={onScan} playSound={false} sameCodeCooldownMs={1200} paused />);
    await wait(2000); await decode('5555');
    expect(onScan).not.toHaveBeenCalledWith('5555');
  });

  it('reports when the camera cannot start', async () => {
    h.startError = Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' });
    const onError = vi.fn();
    render(<InlineContinuousScanner readerId="t2" onScan={() => {}} onError={onError} />);
    await act(async () => {});
    expect(onError).toHaveBeenCalledWith(h.startError);
  });
});

describe('CheckoutCameraScanner', () => {
  let CheckoutCameraScanner;
  beforeAll(async () => {
    vi.resetModules();
    vi.doMock('../components/scanner/InlineContinuousScanner', () => ({
      default: (props) => { h.panelProps = props; return <div data-testid="camera-view" />; },
    }));
    CheckoutCameraScanner = (await import('../components/scanner/CheckoutCameraScanner')).default;
  });
  afterAll(() => { vi.doUnmock('../components/scanner/InlineContinuousScanner'); });

  it('shows the live camera, passes scans through, and can be closed', () => {
    const onScan = vi.fn(); const onClose = vi.fn();
    const { rerender } = render(<CheckoutCameraScanner onScan={onScan} onClose={onClose} paused={false} />);
    expect(screen.getByTestId('camera-view')).toBeInTheDocument();
    expect(screen.getByText('Point the camera at a barcode')).toBeInTheDocument();
    expect(h.panelProps.sameCodeCooldownMs).toBeGreaterThan(0);
    h.panelProps.onScan('1223');
    expect(onScan).toHaveBeenCalledWith('1223');

    expect(screen.getByText(/camera closes once the item is added/)).toBeInTheDocument();

    rerender(<CheckoutCameraScanner onScan={onScan} onClose={onClose} paused />);
    expect(screen.getByText('Paused while a popup is open')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close camera' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('explains camera problems in plain words and can try again', () => {
    render(<CheckoutCameraScanner onScan={() => {}} onClose={() => {}} paused={false} />);
    act(() => { h.panelProps.onError(Object.assign(new Error('x'), { name: 'NotAllowedError' })); });
    expect(screen.getByText(/Camera access is blocked/)).toBeInTheDocument();
    expect(screen.queryByTestId('camera-view')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Try again/ }));
    expect(screen.getByTestId('camera-view')).toBeInTheDocument();

    act(() => { h.panelProps.onError(Object.assign(new Error('Requested device not found'), { name: 'NotFoundError' })); });
    expect(screen.getByText('No camera was found on this device.')).toBeInTheDocument();
  });
});
