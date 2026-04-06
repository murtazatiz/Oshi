/**
 * Expo config plugin — iOS Share Extension (PRD §3.1.3)
 *
 * Runs during `expo prebuild` and modifies the native Xcode project to:
 *   1. Add App Group entitlement (group.com.oshi.app)
 *   2. Create the OshiShareExtension target
 *   3. Generate the Swift ShareViewController and Info.plist
 *   4. Set NSExtensionActivationSupportsWebURLWithMaxCount = 1
 *
 * The generated extension is a lightweight native UIViewController that:
 *   - Extracts the shared URL
 *   - Reads the JWT from App Group UserDefaults
 *   - POSTs to /api/v1/saves
 *   - Falls back to App Group queue when offline
 *   - Shows branded confirmation UI using Oshi theme colours
 *   - Auto-dismisses after 3 seconds
 */
const {
  withXcodeProject,
  withEntitlementsPlist,
  withInfoPlist,
  IOSConfig,
} = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────
const APP_GROUP = 'group.com.oshi.app';
const EXTENSION_NAME = 'OshiShareExtension';
const EXTENSION_BUNDLE_ID_SUFFIX = '.OshiShareExtension';
const SHARE_DEFAULTS_KEY = 'oshi_pending_share';
const SESSION_DEFAULTS_KEY = 'oshi_shared_session';

// ─────────────────────────────────────────────────────────────────────────────
// Swift source for the Share Extension view controller
// ─────────────────────────────────────────────────────────────────────────────
const SHARE_VIEW_CONTROLLER_SWIFT = `
import UIKit
import MobileCoreServices
import UniformTypeIdentifiers

// Oshi theme colours — must stay in sync with app/src/theme/index.ts §7.1
private enum OshiColors {
    static let primary     = UIColor(red: 0.102, green: 0.102, blue: 0.180, alpha: 1) // #1A1A2E
    static let accent      = UIColor(red: 0.914, green: 0.271, blue: 0.376, alpha: 1) // #E94560
    static let background  = UIColor(red: 0.980, green: 0.980, blue: 0.980, alpha: 1) // #FAFAFA
    static let surface     = UIColor.white
    static let textPrimary = UIColor(red: 0.102, green: 0.102, blue: 0.180, alpha: 1)
    static let textMuted   = UIColor(red: 0.600, green: 0.600, blue: 0.600, alpha: 1)
    static let success     = UIColor(red: 0.133, green: 0.773, blue: 0.369, alpha: 1) // #22C55E
    static let border      = UIColor(red: 0.878, green: 0.878, blue: 0.878, alpha: 1) // #E0E0E0
    static let skeleton    = UIColor(red: 0.878, green: 0.878, blue: 0.878, alpha: 1) // #E0E0E0
}

class ShareViewController: UIViewController {

    // MARK: - Properties

    private let appGroup = "${APP_GROUP}"
    private let pendingKey = "${SHARE_DEFAULTS_KEY}"
    private let sessionKey = "${SESSION_DEFAULTS_KEY}"

    private var sharedURL: String?
    private var autoDismissTimer: Timer?

    // MARK: - UI Elements

    private let containerView = UIView()
    private let skeletonView = UIView()
    private let confirmationView = UIView()
    private let thumbnailView = UIView()
    private let titleLabel = UILabel()
    private let subtitleLabel = UILabel()
    private let categoryBadge = UIButton(type: .system)
    private let statusLabel = UILabel()
    private let doneButton = UIButton(type: .system)

    // MARK: - Lifecycle

    override func viewDidLoad() {
        super.viewDidLoad()
        setupUI()
        extractSharedURL()
    }

    // MARK: - UI Setup

    private func setupUI() {
        view.backgroundColor = UIColor.black.withAlphaComponent(0.4)

        // Container card
        containerView.backgroundColor = OshiColors.surface
        containerView.layer.cornerRadius = 20
        containerView.layer.shadowColor = UIColor.black.cgColor
        containerView.layer.shadowOffset = CGSize(width: 0, height: 2)
        containerView.layer.shadowOpacity = 0.12
        containerView.layer.shadowRadius = 12
        containerView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(containerView)

        NSLayoutConstraint.activate([
            containerView.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 16),
            containerView.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -16),
            containerView.centerYAnchor.constraint(equalTo: view.centerYAnchor),
        ])

        setupSkeletonView()
        setupConfirmationView()
        confirmationView.isHidden = true
    }

    private func setupSkeletonView() {
        skeletonView.translatesAutoresizingMaskIntoConstraints = false
        containerView.addSubview(skeletonView)
        NSLayoutConstraint.activate([
            skeletonView.topAnchor.constraint(equalTo: containerView.topAnchor, constant: 20),
            skeletonView.leadingAnchor.constraint(equalTo: containerView.leadingAnchor, constant: 16),
            skeletonView.trailingAnchor.constraint(equalTo: containerView.trailingAnchor, constant: -16),
            skeletonView.bottomAnchor.constraint(equalTo: containerView.bottomAnchor, constant: -20),
        ])

        // Skeleton thumbnail placeholder
        let skThumb = UIView()
        skThumb.backgroundColor = OshiColors.skeleton
        skThumb.layer.cornerRadius = 8
        skThumb.translatesAutoresizingMaskIntoConstraints = false
        skeletonView.addSubview(skThumb)

        // Skeleton text lines
        let skLine1 = UIView()
        skLine1.backgroundColor = OshiColors.skeleton
        skLine1.layer.cornerRadius = 4
        skLine1.translatesAutoresizingMaskIntoConstraints = false
        skeletonView.addSubview(skLine1)

        let skLine2 = UIView()
        skLine2.backgroundColor = OshiColors.skeleton
        skLine2.layer.cornerRadius = 4
        skLine2.translatesAutoresizingMaskIntoConstraints = false
        skeletonView.addSubview(skLine2)

        NSLayoutConstraint.activate([
            skThumb.topAnchor.constraint(equalTo: skeletonView.topAnchor),
            skThumb.leadingAnchor.constraint(equalTo: skeletonView.leadingAnchor),
            skThumb.trailingAnchor.constraint(equalTo: skeletonView.trailingAnchor),
            skThumb.heightAnchor.constraint(equalToConstant: 100),

            skLine1.topAnchor.constraint(equalTo: skThumb.bottomAnchor, constant: 12),
            skLine1.leadingAnchor.constraint(equalTo: skeletonView.leadingAnchor),
            skLine1.widthAnchor.constraint(equalTo: skeletonView.widthAnchor, multiplier: 0.75),
            skLine1.heightAnchor.constraint(equalToConstant: 14),

            skLine2.topAnchor.constraint(equalTo: skLine1.bottomAnchor, constant: 8),
            skLine2.leadingAnchor.constraint(equalTo: skeletonView.leadingAnchor),
            skLine2.widthAnchor.constraint(equalTo: skeletonView.widthAnchor, multiplier: 0.50),
            skLine2.heightAnchor.constraint(equalToConstant: 14),
            skLine2.bottomAnchor.constraint(equalTo: skeletonView.bottomAnchor),
        ])

        // Shimmer animation
        startShimmer(on: skThumb)
        startShimmer(on: skLine1)
        startShimmer(on: skLine2)
    }

    private func startShimmer(on view: UIView) {
        let gradient = CAGradientLayer()
        gradient.colors = [
            UIColor.clear.cgColor,
            UIColor.white.withAlphaComponent(0.4).cgColor,
            UIColor.clear.cgColor,
        ]
        gradient.startPoint = CGPoint(x: 0, y: 0.5)
        gradient.endPoint = CGPoint(x: 1, y: 0.5)
        gradient.frame = CGRect(x: -200, y: 0, width: 400, height: 200)
        gradient.name = "shimmer"
        view.layer.addSublayer(gradient)
        view.clipsToBounds = true

        let animation = CABasicAnimation(keyPath: "position.x")
        animation.fromValue = -200
        animation.toValue = view.bounds.width + 200
        animation.duration = 1.2
        animation.repeatCount = .infinity
        gradient.add(animation, forKey: "shimmer")
    }

    private func setupConfirmationView() {
        confirmationView.translatesAutoresizingMaskIntoConstraints = false
        containerView.addSubview(confirmationView)
        NSLayoutConstraint.activate([
            confirmationView.topAnchor.constraint(equalTo: containerView.topAnchor, constant: 20),
            confirmationView.leadingAnchor.constraint(equalTo: containerView.leadingAnchor, constant: 16),
            confirmationView.trailingAnchor.constraint(equalTo: containerView.trailingAnchor, constant: -16),
            confirmationView.bottomAnchor.constraint(equalTo: containerView.bottomAnchor, constant: -20),
        ])

        // Thumbnail placeholder
        thumbnailView.backgroundColor = OshiColors.skeleton
        thumbnailView.layer.cornerRadius = 8
        thumbnailView.translatesAutoresizingMaskIntoConstraints = false
        confirmationView.addSubview(thumbnailView)

        // Title
        titleLabel.font = .systemFont(ofSize: 16, weight: .semibold)
        titleLabel.textColor = OshiColors.textPrimary
        titleLabel.numberOfLines = 2
        titleLabel.translatesAutoresizingMaskIntoConstraints = false
        confirmationView.addSubview(titleLabel)

        // Subtitle
        subtitleLabel.font = .systemFont(ofSize: 13, weight: .regular)
        subtitleLabel.textColor = OshiColors.textMuted
        subtitleLabel.translatesAutoresizingMaskIntoConstraints = false
        confirmationView.addSubview(subtitleLabel)

        // Category badge
        categoryBadge.setTitle("📌 Other", for: .normal)
        categoryBadge.titleLabel?.font = .systemFont(ofSize: 12, weight: .semibold)
        categoryBadge.setTitleColor(OshiColors.accent, for: .normal)
        categoryBadge.backgroundColor = OshiColors.accent.withAlphaComponent(0.1)
        categoryBadge.layer.cornerRadius = 12
        categoryBadge.contentEdgeInsets = UIEdgeInsets(top: 4, left: 10, bottom: 4, right: 10)
        categoryBadge.translatesAutoresizingMaskIntoConstraints = false
        confirmationView.addSubview(categoryBadge)

        // Status label: "Saved to Oshi ✓" or "Queued"
        statusLabel.font = .systemFont(ofSize: 14, weight: .semibold)
        statusLabel.textColor = OshiColors.success
        statusLabel.text = "Saved to Oshi ✓"
        statusLabel.translatesAutoresizingMaskIntoConstraints = false
        confirmationView.addSubview(statusLabel)

        // Done button
        doneButton.setTitle("Done", for: .normal)
        doneButton.titleLabel?.font = .systemFont(ofSize: 15, weight: .bold)
        doneButton.setTitleColor(.white, for: .normal)
        doneButton.backgroundColor = OshiColors.accent
        doneButton.layer.cornerRadius = 8
        doneButton.translatesAutoresizingMaskIntoConstraints = false
        doneButton.addTarget(self, action: #selector(doneTapped), for: .touchUpInside)
        confirmationView.addSubview(doneButton)

        NSLayoutConstraint.activate([
            thumbnailView.topAnchor.constraint(equalTo: confirmationView.topAnchor),
            thumbnailView.leadingAnchor.constraint(equalTo: confirmationView.leadingAnchor),
            thumbnailView.trailingAnchor.constraint(equalTo: confirmationView.trailingAnchor),
            thumbnailView.heightAnchor.constraint(equalToConstant: 100),

            titleLabel.topAnchor.constraint(equalTo: thumbnailView.bottomAnchor, constant: 12),
            titleLabel.leadingAnchor.constraint(equalTo: confirmationView.leadingAnchor),
            titleLabel.trailingAnchor.constraint(equalTo: confirmationView.trailingAnchor),

            subtitleLabel.topAnchor.constraint(equalTo: titleLabel.bottomAnchor, constant: 4),
            subtitleLabel.leadingAnchor.constraint(equalTo: confirmationView.leadingAnchor),
            subtitleLabel.trailingAnchor.constraint(equalTo: confirmationView.trailingAnchor),

            categoryBadge.topAnchor.constraint(equalTo: subtitleLabel.bottomAnchor, constant: 10),
            categoryBadge.leadingAnchor.constraint(equalTo: confirmationView.leadingAnchor),

            statusLabel.topAnchor.constraint(equalTo: categoryBadge.bottomAnchor, constant: 12),
            statusLabel.leadingAnchor.constraint(equalTo: confirmationView.leadingAnchor),

            doneButton.topAnchor.constraint(equalTo: statusLabel.bottomAnchor, constant: 16),
            doneButton.leadingAnchor.constraint(equalTo: confirmationView.leadingAnchor),
            doneButton.trailingAnchor.constraint(equalTo: confirmationView.trailingAnchor),
            doneButton.heightAnchor.constraint(equalToConstant: 44),
            doneButton.bottomAnchor.constraint(equalTo: confirmationView.bottomAnchor),
        ])
    }

    // MARK: - URL Extraction

    private func extractSharedURL() {
        guard let items = extensionContext?.inputItems as? [NSExtensionItem] else {
            dismiss()
            return
        }

        for item in items {
            guard let attachments = item.attachments else { continue }
            for provider in attachments {
                if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
                    provider.loadItem(forTypeIdentifier: UTType.url.identifier, options: nil) { [weak self] item, _ in
                        if let url = item as? URL {
                            DispatchQueue.main.async {
                                self?.handleSharedURL(url.absoluteString)
                            }
                        }
                    }
                    return
                }
                // Fallback: plain text that might contain a URL
                if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
                    provider.loadItem(forTypeIdentifier: UTType.plainText.identifier, options: nil) { [weak self] item, _ in
                        if let text = item as? String, let url = URL(string: text), url.scheme != nil {
                            DispatchQueue.main.async {
                                self?.handleSharedURL(url.absoluteString)
                            }
                        }
                    }
                    return
                }
            }
        }

        // No URL found
        dismiss()
    }

    // MARK: - Save Logic

    private func handleSharedURL(_ urlString: String) {
        sharedURL = urlString
        titleLabel.text = urlString
        subtitleLabel.text = detectPlatform(urlString)

        // Attempt API call with shared JWT
        let defaults = UserDefaults(suiteName: appGroup)
        let jwt = defaults?.string(forKey: sessionKey)

        if let jwt = jwt, !jwt.isEmpty {
            saveViaAPI(url: urlString, jwt: jwt)
        } else {
            // No JWT available — queue for later
            queuePendingShare(urlString)
        }
    }

    private func saveViaAPI(url: String, jwt: String) {
        guard let apiBase = loadAPIBaseURL() else {
            queuePendingShare(url)
            return
        }

        let endpoint = "\\(apiBase)/saves"
        guard let requestURL = URL(string: endpoint) else {
            queuePendingShare(url)
            return
        }

        var request = URLRequest(url: requestURL)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \\(jwt)", forHTTPHeaderField: "Authorization")
        request.timeoutInterval = 8

        let body: [String: Any] = [
            "url": url,
            "source_app": detectSourceApp(url),
        ]
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)

        let task = URLSession.shared.dataTask(with: request) { [weak self] data, response, error in
            DispatchQueue.main.async {
                if let error = error {
                    // Offline or network error — queue it
                    self?.queuePendingShare(url)
                    return
                }

                guard let httpResponse = response as? HTTPURLResponse else {
                    self?.queuePendingShare(url)
                    return
                }

                if (200...299).contains(httpResponse.statusCode) {
                    self?.showConfirmation(saved: true)

                    // Try to parse the category from the response
                    if let data = data,
                       let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                       let category = json["category"] as? [String: Any],
                       let catName = category["name"] as? String {
                        self?.categoryBadge.setTitle("📌 \\(catName)", for: .normal)
                    }
                } else {
                    // Server error — queue the share
                    self?.queuePendingShare(url)
                }
            }
        }
        task.resume()
    }

    private func queuePendingShare(_ url: String) {
        let defaults = UserDefaults(suiteName: appGroup)

        // Append to existing queue (JSON array of pending URLs)
        var queue: [[String: Any]] = []
        if let existing = defaults?.array(forKey: pendingKey) as? [[String: Any]] {
            queue = existing
        }

        queue.append([
            "url": url,
            "source_app": detectSourceApp(url),
            "timestamp": ISO8601DateFormatter().string(from: Date()),
        ])

        defaults?.set(queue, forKey: pendingKey)
        defaults?.synchronize()

        showConfirmation(saved: false)
    }

    // MARK: - Confirmation UI

    private func showConfirmation(saved: Bool) {
        // Light haptic
        let generator = UIImpactFeedbackGenerator(style: .light)
        generator.impactOccurred()

        // Transition from skeleton to confirmation
        UIView.animate(withDuration: 0.25) {
            self.skeletonView.alpha = 0
        } completion: { _ in
            self.skeletonView.isHidden = true
            self.confirmationView.isHidden = false
            self.confirmationView.alpha = 0
            UIView.animate(withDuration: 0.25) {
                self.confirmationView.alpha = 1
            }
        }

        if saved {
            statusLabel.text = "Saved to Oshi ✓"
            statusLabel.textColor = OshiColors.success
        } else {
            statusLabel.text = "Queued — will save when back online"
            statusLabel.textColor = OshiColors.textMuted
        }

        // Auto-dismiss after 3 seconds (PRD §3.1.1)
        autoDismissTimer = Timer.scheduledTimer(withTimeInterval: 3.0, repeats: false) { [weak self] _ in
            self?.dismiss()
        }
    }

    // MARK: - Helpers

    private func detectSourceApp(_ url: String) -> String {
        let lower = url.lowercased()
        if lower.contains("instagram.com")  { return "instagram" }
        if lower.contains("youtube.com") || lower.contains("youtu.be") { return "youtube" }
        if lower.contains("tiktok.com")     { return "tiktok" }
        if lower.contains("twitter.com") || lower.contains("x.com") { return "twitter" }
        if lower.contains("linkedin.com")   { return "linkedin" }
        if lower.contains("spotify.com")    { return "spotify" }
        return "web"
    }

    private func detectPlatform(_ url: String) -> String {
        let source = detectSourceApp(url)
        switch source {
        case "instagram": return "Instagram preview may be limited"
        case "youtube":   return "YouTube"
        case "tiktok":    return "TikTok preview may be limited"
        case "twitter":   return "X (Twitter)"
        case "linkedin":  return "LinkedIn"
        case "spotify":   return "Spotify"
        default:          return "Web"
        }
    }

    private func loadAPIBaseURL() -> String? {
        // Read from App Group (set by main app on launch)
        let defaults = UserDefaults(suiteName: appGroup)
        return defaults?.string(forKey: "oshi_api_base_url")
    }

    @objc private func doneTapped() {
        dismiss()
    }

    private func dismiss() {
        autoDismissTimer?.invalidate()
        extensionContext?.completeRequest(returningItems: nil, completionHandler: nil)
    }
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// Extension Info.plist content
// ─────────────────────────────────────────────────────────────────────────────
const EXTENSION_INFO_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>NSExtension</key>
  <dict>
    <key>NSExtensionPointIdentifier</key>
    <string>com.apple.share-services</string>
    <key>NSExtensionPrincipalClass</key>
    <string>ShareViewController</string>
    <key>NSExtensionAttributes</key>
    <dict>
      <key>NSExtensionActivationRule</key>
      <dict>
        <key>NSExtensionActivationSupportsWebURLWithMaxCount</key>
        <integer>1</integer>
      </dict>
    </dict>
  </dict>
  <key>CFBundleDisplayName</key>
  <string>Oshi</string>
  <key>CFBundleName</key>
  <string>OshiShareExtension</string>
  <key>CFBundleShortVersionString</key>
  <string>1.0</string>
  <key>CFBundleVersion</key>
  <string>1</string>
</dict>
</plist>
`;

// ─────────────────────────────────────────────────────────────────────────────
// Extension entitlements
// ─────────────────────────────────────────────────────────────────────────────
const EXTENSION_ENTITLEMENTS = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.application-groups</key>
  <array>
    <string>${APP_GROUP}</string>
  </array>
</dict>
</plist>
`;

// ─────────────────────────────────────────────────────────────────────────────
// Plugin implementation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Writes the native Share Extension source files into the iOS project
 * directory during `expo prebuild`.
 */
function withShareExtensionFiles(config) {
  return withXcodeProject(config, async (cfg) => {
    const projectRoot = cfg.modRequest.projectRoot;
    const iosDir = path.join(projectRoot, 'ios');
    const extDir = path.join(iosDir, EXTENSION_NAME);

    // Create extension directory
    if (!fs.existsSync(extDir)) {
      fs.mkdirSync(extDir, { recursive: true });
    }

    // Write Swift source
    fs.writeFileSync(
      path.join(extDir, 'ShareViewController.swift'),
      SHARE_VIEW_CONTROLLER_SWIFT.trim(),
    );

    // Write Info.plist
    fs.writeFileSync(
      path.join(extDir, 'Info.plist'),
      EXTENSION_INFO_PLIST.trim(),
    );

    // Write entitlements
    fs.writeFileSync(
      path.join(extDir, `${EXTENSION_NAME}.entitlements`),
      EXTENSION_ENTITLEMENTS.trim(),
    );

    // ── Add target to Xcode project ───────────────────────────────────────
    const xcodeProject = cfg.modResults;
    const mainBundleId = cfg.ios?.bundleIdentifier ?? 'com.oshi.app';
    const extBundleId = mainBundleId + EXTENSION_BUNDLE_ID_SUFFIX;

    // Check if target already exists
    const existingTarget = xcodeProject.pbxTargetByName(EXTENSION_NAME);
    if (!existingTarget) {
      const target = xcodeProject.addTarget(
        EXTENSION_NAME,
        'app_extension',
        EXTENSION_NAME,
        extBundleId,
      );

      // Add source files to the extension target
      const groupKey = xcodeProject.pbxCreateGroup(EXTENSION_NAME, EXTENSION_NAME);
      const mainGroup = xcodeProject.getFirstProject().firstProject.mainGroup;
      xcodeProject.addToPbxGroup(groupKey, mainGroup);

      xcodeProject.addFile(
        `${EXTENSION_NAME}/ShareViewController.swift`,
        groupKey,
        { target: target.uuid },
      );
      xcodeProject.addFile(
        `${EXTENSION_NAME}/Info.plist`,
        groupKey,
      );

      // Set build settings for the extension
      const buildConfigs = xcodeProject.pbxXCBuildConfigurationSection();
      for (const key of Object.keys(buildConfigs)) {
        const config = buildConfigs[key];
        if (
          typeof config === 'object' &&
          config.buildSettings &&
          config.buildSettings.PRODUCT_NAME === `"${EXTENSION_NAME}"`
        ) {
          config.buildSettings.INFOPLIST_FILE = `${EXTENSION_NAME}/Info.plist`;
          config.buildSettings.CODE_SIGN_ENTITLEMENTS = `${EXTENSION_NAME}/${EXTENSION_NAME}.entitlements`;
          config.buildSettings.SWIFT_VERSION = '5.0';
          config.buildSettings.TARGETED_DEVICE_FAMILY = '"1"';
          config.buildSettings.IPHONEOS_DEPLOYMENT_TARGET = '15.0';
        }
      }
    }

    return cfg;
  });
}

/**
 * Ensure the main app has the App Group entitlement.
 */
function withAppGroupEntitlement(config) {
  return withEntitlementsPlist(config, (cfg) => {
    const groups = cfg.modResults['com.apple.security.application-groups'] || [];
    if (!groups.includes(APP_GROUP)) {
      groups.push(APP_GROUP);
    }
    cfg.modResults['com.apple.security.application-groups'] = groups;
    return cfg;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Main plugin export
// ─────────────────────────────────────────────────────────────────────────────
function withShareExtension(config) {
  config = withAppGroupEntitlement(config);
  config = withShareExtensionFiles(config);
  return config;
}

module.exports = withShareExtension;
