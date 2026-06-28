<?php
/**
 * proxy.php — minimal same-origin fetch proxy for WhisperBrowser's podcast
 * feature. The browser cannot read the raw bytes of a cross-origin podcast
 * feed/episode unless the host sends CORS headers (most don't), so this script
 * fetches it server-side and streams it back. Transcription still happens
 * entirely in the browser — this only moves bytes.
 *
 * Includes basic SSRF protection (blocks private/reserved IPs). Review and
 * harden for your environment (e.g. an allow-list of hosts) before exposing
 * it publicly.
 *
 * Requires PHP with the cURL extension.
 */

header('Access-Control-Allow-Origin: *');

$url = isset($_GET['url']) ? $_GET['url'] : '';
if ($url === '') {
    http_response_code(400);
    echo 'Missing url parameter';
    exit;
}

$parts = parse_url($url);
if ($parts === false || empty($parts['scheme']) || empty($parts['host'])) {
    http_response_code(400);
    echo 'Invalid url';
    exit;
}

$scheme = strtolower($parts['scheme']);
if ($scheme !== 'http' && $scheme !== 'https') {
    http_response_code(400);
    echo 'Only http/https URLs are allowed';
    exit;
}

// --- SSRF guard: refuse hosts that resolve to private/reserved addresses ----
$host = $parts['host'];
$ips = @gethostbynamel($host);
if ($ips === false) {
    $ips = array();
    if (filter_var($host, FILTER_VALIDATE_IP)) {
        $ips[] = $host;
    } else {
        $rec = @dns_get_record($host, DNS_AAAA);
        if ($rec) {
            foreach ($rec as $r) {
                if (isset($r['ipv6'])) $ips[] = $r['ipv6'];
            }
        }
    }
}
if (empty($ips)) {
    http_response_code(502);
    echo 'DNS resolution failed';
    exit;
}
foreach ($ips as $ip) {
    if (!filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE)) {
        http_response_code(403);
        echo 'Blocked private/reserved address';
        exit;
    }
}

// --- Stream the upstream response back to the client ------------------------
while (ob_get_level() > 0) {
    ob_end_flush();
}

$ch = curl_init($url);
curl_setopt_array($ch, array(
    CURLOPT_FOLLOWLOCATION => true,
    CURLOPT_MAXREDIRS      => 5,
    CURLOPT_CONNECTTIMEOUT => 15,
    CURLOPT_TIMEOUT        => 900,
    CURLOPT_ENCODING       => '', // accept + transparently decode compression
    CURLOPT_USERAGENT      => 'WhisperBrowser-proxy/1.0 (+https://github.com/)',
    CURLOPT_HTTPHEADER     => array('Accept: */*'),
    CURLOPT_HEADERFUNCTION => function ($ch, $header) {
        // Forward only the content type; let the body stream through.
        if (stripos(trim($header), 'Content-Type:') === 0) {
            header(trim($header));
        }
        return strlen($header);
    },
    CURLOPT_WRITEFUNCTION  => function ($ch, $data) {
        echo $data;
        flush();
        return strlen($data);
    },
));

$ok = curl_exec($ch);
if ($ok === false) {
    http_response_code(502);
    echo 'Upstream fetch failed: ' . curl_error($ch);
}
curl_close($ch);
