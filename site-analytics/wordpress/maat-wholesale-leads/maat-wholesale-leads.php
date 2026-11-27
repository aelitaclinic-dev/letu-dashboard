<?php
/**
 * Plugin Name: MAAT Wholesale Leads
 * Description: Рабочие оптовые заявки после входа, приём формы № 3 и уведомление в MAX. На сайте этот файл подключён сниппетом, второй раз плагин включать не нужно.
 * Version: 1.1.0
 * Author: MA Distribution
 * Requires at least: 6.0
 * Requires PHP: 7.4
 */

if (!defined('ABSPATH')) {
    exit;
}

if (!function_exists('maat_wl_clip')) {

if (!defined('MAAT_WL_LEADS')) {
    define('MAAT_WL_LEADS', 'maat_wholesale_leads');
    define('MAAT_WL_SEQ', 'maat_wholesale_leads_seq');
    define('MAAT_WL_TOKEN', 'maat_max_bot_token');
    define('MAAT_WL_USER', 'maat_max_notify_user_id');
}

function maat_wl_clip($value, $max) {
    $value = trim(sanitize_text_field((string) $value));
    if (function_exists('mb_substr')) {
        return mb_substr($value, 0, $max);
    }
    return substr($value, 0, $max);
}

function maat_wl_channels() {
    return array(
        'telegram' => 'Telegram',
        'instagram' => 'Instagram',
        'whatsapp' => 'WhatsApp',
        'max' => 'MAX',
        'form' => 'Форма сайта',
        'site-chat' => 'Чат на сайте',
    );
}

function maat_wl_sources() {
    return array(
        'site' => 'сайт',
        'social' => 'соцсеть',
        'referral' => 'рекомендация',
        'direct' => 'прямое обращение',
        'unknown' => 'неизвестен',
    );
}

function maat_wl_can() {
    return current_user_can('manage_options');
}

function maat_wl_read() {
    $stored = get_option(MAAT_WL_LEADS, array());
    $leads = is_array($stored) ? $stored : array();
    $changed = false;
    $max = (int) get_option(MAAT_WL_SEQ, 0);
    foreach ($leads as $index => $lead) {
        if (!is_array($lead)) {
            continue;
        }
        if (empty($lead['number'])) {
            $max++;
            $leads[$index]['number'] = $max;
            $changed = true;
        } else {
            $max = max($max, (int) $lead['number']);
        }
        if (empty($lead['notify']) || !is_array($lead['notify'])) {
            $leads[$index]['notify'] = array('status' => 'skipped', 'reason' => 'import');
            $changed = true;
        }
        if (empty($lead['source'])) {
            $leads[$index]['source'] = 'unknown';
            $changed = true;
        }
        if (($lead['channel'] ?? '') === 'form' && ($lead['source'] ?? '') === 'site') {
            $leads[$index]['channel'] = 'form';
        }
    }
    if ($changed) {
        update_option(MAAT_WL_LEADS, array_values($leads), false);
        update_option(MAAT_WL_SEQ, $max, false);
    }
    return array_values($leads);
}

function maat_wl_write($leads) {
    update_option(MAAT_WL_LEADS, array_values($leads), false);
}

function maat_wl_next_number() {
    $next = (int) get_option(MAAT_WL_SEQ, 0) + 1;
    update_option(MAAT_WL_SEQ, $next, false);
    return $next;
}

function maat_wl_find($leads, $id) {
    foreach ($leads as $index => $lead) {
        if (is_array($lead) && isset($lead['id']) && $lead['id'] === $id) {
            return $index;
        }
    }
    return -1;
}

function maat_wl_notice_text($lead) {
    $sources = maat_wl_sources();
    $channels = maat_wl_channels();
    $source = isset($sources[$lead['source']]) ? $sources[$lead['source']] : 'неизвестен';
    $channel = isset($channels[$lead['channel']]) ? $channels[$lead['channel']] : 'Неизвестно';
    $url = 'https://maat-impera.ru/wholesale-leads/#lead-' . rawurlencode($lead['id']);
    return "Новая оптовая заявка № " . $lead['number'] . "\nКанал: " . $channel . "\nИсточник: " . $source . "\nОткрыть заявку: " . $url;
}

function maat_wl_max_request($method, $path, $body = null) {
    $token = (string) get_option(MAAT_WL_TOKEN, '');
    if ($token === '') {
        return new WP_Error('maat_max_token', 'Нет токена бота MAX');
    }
    $args = array(
        'method' => $method,
        'timeout' => 15,
        'headers' => array('Authorization' => $token, 'Content-Type' => 'application/json'),
    );
    if ($body !== null) {
        $args['body'] = wp_json_encode($body);
    }
    $response = wp_remote_request('https://platform-api2.max.ru' . $path, $args);
    if (is_wp_error($response)) {
        return $response;
    }
    $code = (int) wp_remote_retrieve_response_code($response);
    $decoded = json_decode(wp_remote_retrieve_body($response), true);
    if ($code < 200 || $code >= 300) {
        $message = is_array($decoded) && isset($decoded['message']) ? $decoded['message'] : 'MAX ответил ошибкой';
        return new WP_Error('maat_max_http', $message);
    }
    return is_array($decoded) ? $decoded : array();
}

function maat_wl_bind_user() {
    $data = maat_wl_max_request('GET', '/updates?timeout=0&limit=20');
    if (is_wp_error($data)) {
        return $data;
    }
    $updates = isset($data['updates']) && is_array($data['updates']) ? $data['updates'] : array();
    foreach (array_reverse($updates) as $update) {
        $user = isset($update['user']) && is_array($update['user']) ? $update['user'] : array();
        if (empty($user) && isset($update['message']['sender']) && is_array($update['message']['sender'])) {
            $user = $update['message']['sender'];
        }
        if (!empty($user['user_id']) && empty($user['is_bot'])) {
            update_option(MAAT_WL_USER, (string) $user['user_id'], false);
            update_option('maat_max_notify_name', maat_wl_clip($user['name'] ?? '', 120), false);
            return (string) $user['user_id'];
        }
    }
    return new WP_Error('maat_max_user', 'Личный чат не привязан. Откройте бота и нажмите «Начать».');
}

function maat_wl_notify_lead(&$lead, $event) {
    if (empty($event['created']) || !empty($event['imported']) || !empty($event['demo']) || !empty($event['duplicate']) || !empty($event['edited'])) {
        return;
    }
    if (!empty($lead['notify']['status']) && $lead['notify']['status'] === 'sent') {
        return;
    }
    $user = (string) get_option(MAAT_WL_USER, '');
    if ($user === '') {
        $bound = maat_wl_bind_user();
        if (is_wp_error($bound)) {
            $lead['notify'] = array('status' => 'error', 'error' => $bound->get_error_message());
            return;
        }
        $user = $bound;
    }
    $result = maat_wl_max_request('POST', '/messages?user_id=' . rawurlencode($user), array(
        'text' => maat_wl_notice_text($lead),
        'disable_link_preview' => true,
    ));
    if (is_wp_error($result)) {
        $lead['notify'] = array('status' => 'error', 'error' => $result->get_error_message());
        return;
    }
    $lead['notify'] = array('status' => 'sent', 'sentAt' => gmdate('c'));
}

function maat_wl_store_new($lead, $event) {
    $leads = maat_wl_read();
    if (!empty($lead['externalId'])) {
        foreach ($leads as $item) {
            if (is_array($item) && ($item['externalId'] ?? '') === $lead['externalId']) {
                return array('created' => false, 'lead' => $item);
            }
        }
    }
    if (!empty($lead['conversationId'])) {
        foreach ($leads as $index => $item) {
            if (is_array($item) && ($item['conversationId'] ?? '') === $lead['conversationId']) {
                $history = isset($item['history']) && is_array($item['history']) ? $item['history'] : array();
                $history[] = array('at' => gmdate('c'), 'kind' => 'message', 'text' => maat_wl_clip($lead['request'] ?? '', 2000));
                $leads[$index]['history'] = array_slice($history, -50);
                maat_wl_write($leads);
                return array('created' => false, 'lead' => $leads[$index]);
            }
        }
    }
    $lead['number'] = maat_wl_next_number();
    $lead['history'] = array(array('at' => $lead['receivedAt'], 'kind' => 'message', 'text' => $lead['request']));
    $lead['notify'] = array('status' => 'pending');
    maat_wl_notify_lead($lead, $event);
    $leads[] = $lead;
    maat_wl_write($leads);
    return array('created' => true, 'lead' => $lead);
}

function maat_wl_lead_from_response($submission_id, $response, $created_at) {
    $submission_id = preg_replace('/[^A-Za-z0-9_-]/', '', (string) $submission_id);
    if ($submission_id === '') {
        return null;
    }
    if (!is_array($response)) {
        $decoded = json_decode((string) $response, true);
        $response = is_array($decoded) ? $decoded : array();
    }
    $name = maat_wl_clip($response['input_text_1'] ?? '', 240);
    $phone = maat_wl_clip($response['input_text'] ?? '', 80);
    $email = sanitize_email($response['email'] ?? '');
    $company = maat_wl_clip($response['input_text_2'] ?? '', 240);
    if ($name === '' && $phone === '' && $email === '') {
        return null;
    }
    try {
        $moment = new DateTime($created_at ? $created_at : 'now', new DateTimeZone('UTC'));
    } catch (Exception $error) {
        $moment = new DateTime('now', new DateTimeZone('UTC'));
    }
    return array(
        'id' => 'ff3-' . $submission_id,
        'externalId' => 'fluentform:3:' . $submission_id,
        'conversationId' => '',
        'receivedAt' => $moment->format('c'),
        'name' => $name,
        'phone' => $phone,
        'email' => $email,
        'request' => $company !== '' ? maat_wl_clip('Прайс для ' . $company, 500) : 'Запрос оптового прайса',
        'source' => 'site',
        'channel' => 'form',
        'referrer' => '',
        'stage' => 'new',
        'firstReplyAt' => null,
    );
}

function maat_wl_store_submission($submission_id, $form_data, $form) {
    $form_id = 0;
    if (is_object($form) && isset($form->id)) {
        $form_id = (int) $form->id;
    } elseif (is_array($form) && isset($form['id'])) {
        $form_id = (int) $form['id'];
    } elseif (is_numeric($form)) {
        $form_id = (int) $form;
    }
    if ($form_id !== 3) {
        return;
    }
    $lead = maat_wl_lead_from_response($submission_id, $form_data, gmdate('Y-m-d H:i:s'));
    if ($lead) {
        maat_wl_store_new($lead, array('created' => true));
    }
}

function maat_wl_public_lead($lead) {
    $notify = isset($lead['notify']) && is_array($lead['notify']) ? $lead['notify'] : array();
    $lead['notifyStatus'] = isset($notify['status']) ? $notify['status'] : '';
    $lead['notifyError'] = isset($notify['error']) ? maat_wl_clip($notify['error'], 240) : '';
    unset($lead['notify']);
    return $lead;
}

add_action('fluentform/submission_inserted', 'maat_wl_store_submission', 10, 3);
add_action('fluentform_submission_inserted', 'maat_wl_store_submission', 10, 3);

add_action('rest_api_init', function () {
    register_rest_route('maat/v1', '/wholesale-leads', array(
        array(
            'methods' => 'GET',
            'permission_callback' => 'maat_wl_can',
            'callback' => function () {
                $leads = array_map('maat_wl_public_lead', maat_wl_read());
                return array('schemaVersion' => 2, 'leads' => $leads);
            },
        ),
        array(
            'methods' => 'POST',
            'permission_callback' => 'maat_wl_can',
            'callback' => function (WP_REST_Request $request) {
                $body = $request->get_json_params();
                $name = maat_wl_clip($body['name'] ?? '', 240);
                $phone = maat_wl_clip($body['phone'] ?? '', 80);
                $email = sanitize_email($body['email'] ?? '');
                $channel = sanitize_key($body['channel'] ?? '');
                $source = sanitize_key($body['source'] ?? 'unknown');
                $referrer = maat_wl_clip($body['referrer'] ?? '', 240);
                $request_text = maat_wl_clip($body['request'] ?? '', 500);
                if (!isset(maat_wl_channels()[$channel]) || !isset(maat_wl_sources()[$source]) || $request_text === '' || ($name === '' && $phone === '' && $email === '')) {
                    return new WP_Error('maat_wl_bad', 'Проверьте канал, источник, контакт и запрос.', array('status' => 400));
                }
                if ($source === 'referral' && $referrer === '') {
                    return new WP_Error('maat_wl_referrer', 'Укажите, кто рекомендовал.', array('status' => 400));
                }
                $lead = array(
                    'id' => 'wl-' . wp_generate_password(12, false, false),
                    'externalId' => '',
                    'conversationId' => '',
                    'receivedAt' => gmdate('c'),
                    'name' => $name,
                    'phone' => $phone,
                    'email' => $email,
                    'request' => $request_text,
                    'source' => $source,
                    'channel' => $channel,
                    'referrer' => $source === 'referral' ? $referrer : '',
                    'stage' => 'new',
                    'firstReplyAt' => null,
                );
                $saved = maat_wl_store_new($lead, array('created' => true));
                return array('lead' => maat_wl_public_lead($saved['lead']), 'created' => $saved['created']);
            },
        ),
    ));

    register_rest_route('maat/v1', '/wholesale-leads/(?P<id>[A-Za-z0-9_-]+)/reply', array(
        'methods' => 'POST',
        'permission_callback' => 'maat_wl_can',
        'callback' => function (WP_REST_Request $request) {
            $leads = maat_wl_read();
            $index = maat_wl_find($leads, $request['id']);
            if ($index < 0) {
                return new WP_Error('maat_wl_missing', 'Заявка не найдена.', array('status' => 404));
            }
            if (empty($leads[$index]['firstReplyAt'])) {
                $leads[$index]['firstReplyAt'] = gmdate('c');
                $history = isset($leads[$index]['history']) && is_array($leads[$index]['history']) ? $leads[$index]['history'] : array();
                $history[] = array('at' => gmdate('c'), 'kind' => 'reply', 'text' => 'Ответ отправлен');
                $leads[$index]['history'] = $history;
                maat_wl_write($leads);
            }
            return array('lead' => maat_wl_public_lead($leads[$index]));
        },
    ));

    register_rest_route('maat/v1', '/wholesale-leads/chat', array(
        'methods' => 'POST',
        'permission_callback' => '__return_true',
        'callback' => function (WP_REST_Request $request) {
            $ip = isset($_SERVER['REMOTE_ADDR']) ? $_SERVER['REMOTE_ADDR'] : 'unknown';
            $key = 'maat_wl_chat_' . md5($ip);
            $count = (int) get_transient($key);
            if ($count >= 8) {
                return new WP_Error('maat_wl_rate', 'Слишком много сообщений. Попробуйте позже.', array('status' => 429));
            }
            set_transient($key, $count + 1, HOUR_IN_SECONDS);
            $body = $request->get_json_params();
            $conversation = maat_wl_clip($body['conversationId'] ?? '', 120);
            $message = maat_wl_clip($body['message'] ?? '', 2000);
            if ($conversation === '' || $message === '') {
                return new WP_Error('maat_wl_chat', 'Нужны идентификатор диалога и первое сообщение.', array('status' => 400));
            }
            $lead = array(
                'id' => 'chat-' . substr(md5($conversation), 0, 16),
                'externalId' => '',
                'conversationId' => $conversation,
                'receivedAt' => gmdate('c'),
                'name' => maat_wl_clip($body['name'] ?? 'Посетитель сайта', 240),
                'phone' => maat_wl_clip($body['phone'] ?? '', 80),
                'email' => sanitize_email($body['email'] ?? ''),
                'request' => $message,
                'source' => 'site',
                'channel' => 'site-chat',
                'referrer' => '',
                'stage' => 'new',
                'firstReplyAt' => null,
            );
            if ($lead['name'] === '' && $lead['phone'] === '' && $lead['email'] === '') {
                $lead['name'] = 'Посетитель сайта';
            }
            $saved = maat_wl_store_new($lead, array('created' => true));
            return array('created' => $saved['created'], 'number' => $saved['lead']['number'], 'id' => $saved['lead']['id']);
        },
    ));

    register_rest_route('maat/v1', '/wholesale-leads/notify-retry', array(
        'methods' => 'POST',
        'permission_callback' => 'maat_wl_can',
        'callback' => function () {
            $leads = maat_wl_read();
            $retried = 0;
            foreach ($leads as $index => $lead) {
                if (!is_array($lead) || ($lead['notify']['status'] ?? '') !== 'error') {
                    continue;
                }
                maat_wl_notify_lead($leads[$index], array('created' => true));
                $retried++;
            }
            maat_wl_write($leads);
            return array('retried' => $retried);
        },
    ));
});

add_shortcode('maat_wholesale_leads', function () {
    if (!maat_wl_can()) {
        nocache_headers();
        return '<section class="maat-wl-login"><h1>Входящие оптовые заявки</h1><p>Список открывается после входа.</p>' . wp_login_form(array('echo' => false, 'redirect' => 'https://maat-impera.ru/wholesale-leads/')) . '</section>';
    }
    nocache_headers();
    $nonce = wp_create_nonce('wp_rest');
    return '<div id="wl-work"></div><script>window.MAAT_LEADS=' . wp_json_encode(array(
        'api' => esc_url_raw(rest_url('maat/v1/wholesale-leads')),
        'nonce' => $nonce,
    )) . ';</script><script src="https://aelitaclinic-dev.github.io/letu-dashboard/wholesale-leads.js?v=20261128-leads-desk"></script>';
});

add_action('wp_enqueue_scripts', function () {
    if (!is_page('wholesale-leads')) {
        return;
    }
    wp_enqueue_style('maat-wholesale-leads', 'https://aelitaclinic-dev.github.io/letu-dashboard/purchases.css?v=20261128-leads-desk', array(), null);
});

add_action('wp_footer', function () {
    if (!is_page('wholesale-leads') || !maat_wl_can()) {
        return;
    }
    echo '<script>if(window.WholesaleLeads&&window.MAAT_LEADS){window.WholesaleLeads.mount(document.getElementById("wl-work"),{demo:false,api:window.MAAT_LEADS.api,nonce:window.MAAT_LEADS.nonce});}</script>';
});

add_action('init', function () {
    if (get_option('maat_wl_page_ready')) {
        return;
    }
    $existing = get_page_by_path('wholesale-leads');
    if ($existing) {
        update_option('maat_wl_page_ready', (int) $existing->ID, false);
        return;
    }
    $id = wp_insert_post(array(
        'post_title' => 'Входящие оптовые заявки',
        'post_name' => 'wholesale-leads',
        'post_status' => 'publish',
        'post_type' => 'page',
        'post_content' => '[maat_wholesale_leads]',
    ));
    if ($id && !is_wp_error($id)) {
        update_option('maat_wl_page_ready', (int) $id, false);
    }
});

add_action('admin_menu', function () {
    add_menu_page('Оптовые заявки', 'Оптовые заявки', 'manage_options', 'maat-wholesale-leads', 'maat_wl_admin_page', 'dashicons-email', 58);
});

function maat_wl_admin_page() {
    if (!maat_wl_can()) {
        return;
    }
    $notice = '';
    if (isset($_POST['maat_wl_save']) && check_admin_referer('maat_wl_settings')) {
        $posted = trim((string) ($_POST['maat_max_token'] ?? ''));
        if ($posted !== '') {
            update_option(MAAT_WL_TOKEN, $posted, false);
        }
        $check = maat_wl_max_request('GET', '/me');
        if (is_wp_error($check)) {
            $notice = $check->get_error_message();
        } else {
            $bound = maat_wl_bind_user();
            $notice = is_wp_error($bound) ? 'Бот ответил. ' . $bound->get_error_message() : 'Бот ответил, личный чат привязан.';
            $stored = maat_wl_read();
            foreach ($stored as $index => $stored_lead) {
                if (is_array($stored_lead) && ($stored_lead['notify']['status'] ?? '') === 'error') {
                    maat_wl_notify_lead($stored[$index], array('created' => true));
                }
            }
            maat_wl_write($stored);
        }
    }
    $has = (string) get_option(MAAT_WL_TOKEN, '') !== '';
    $name = (string) get_option('maat_max_notify_name', '');
    echo '<div class="wrap"><h1>Уведомления MAX</h1>';
    if ($notice !== '') {
        echo '<div class="notice notice-info"><p>' . esc_html($notice) . '</p></div>';
    }
    echo '<p>Токен хранится только на сервере. В сообщение не попадают телефон, почта и текст переписки.</p>';
    echo '<form method="post">';
    wp_nonce_field('maat_wl_settings');
    echo '<p><label>Токен бота MAX<br><input type="password" name="maat_max_token" value="" autocomplete="off" class="regular-text" placeholder="' . esc_attr($has ? 'Токен уже сохранён' : 'Вставьте токен') . '"></label></p>';
    echo '<p>' . ($name !== '' ? 'Привязан чат: ' . esc_html($name) : 'Личный чат пока не привязан.') . '</p>';
    echo '<p><button class="button button-primary" name="maat_wl_save" value="1">Сохранить и проверить</button></p></form>';
    echo '<p>Откройте своего бота в MAX и нажмите «Начать», затем снова сохраните токен.</p></div>';
}

}
