<?php
/**
 * Plugin Name: MAAT Wholesale Leads
 * Description: Кладёт отправки Fluent Forms № 3 в очередь оптовых заявок без повторов одной и той же отправки. На рабочем сайте эта же логика уже включена сниппетом «MAAT оптовые заявки формы прайса». Второй раз её включать не нужно.
 * Version: 1.0.0
 * Author: MA Distribution
 * Requires at least: 6.0
 * Requires PHP: 7.4
 */

if (!defined('ABSPATH')) {
    exit;
}

const MAAT_WL_OPTION = 'maat_wholesale_leads';
const MAAT_WL_IMPORTED = 'maat_wholesale_leads_imported';

function maat_wl_clip($value, $max) {
    $value = trim(sanitize_text_field((string) $value));
    if (function_exists('mb_substr')) {
        return mb_substr($value, 0, $max);
    }
    return substr($value, 0, $max);
}

function maat_wl_received_at($mysql_gmt) {
    try {
        $moment = new DateTime($mysql_gmt ? $mysql_gmt : 'now', new DateTimeZone('UTC'));
    } catch (Exception $error) {
        $moment = new DateTime('now', new DateTimeZone('UTC'));
    }
    $moment->setTimezone(new DateTimeZone('Europe/Moscow'));
    return $moment->format('Y-m-d\TH:i:sP');
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
    $name = maat_wl_clip(isset($response['input_text_1']) ? $response['input_text_1'] : '', 240);
    $phone = maat_wl_clip(isset($response['input_text']) ? $response['input_text'] : '', 80);
    $email = sanitize_email(isset($response['email']) ? $response['email'] : '');
    $company = maat_wl_clip(isset($response['input_text_2']) ? $response['input_text_2'] : '', 240);
    if ($name === '' && $phone === '' && $email === '') {
        return null;
    }
    $request = $company !== '' ? maat_wl_clip('Прайс для ' . $company, 500) : 'Запрос оптового прайса';
    return array(
        'id' => 'ff3-' . $submission_id,
        'externalId' => 'fluentform:3:' . $submission_id,
        'receivedAt' => maat_wl_received_at($created_at),
        'name' => $name,
        'phone' => $phone,
        'email' => $email,
        'request' => $request,
        'source' => 'site',
        'channel' => 'form',
        'referrer' => '',
        'stage' => 'new',
        'firstReplyAt' => null,
    );
}

function maat_wl_read() {
    $stored = get_option(MAAT_WL_OPTION, array());
    return is_array($stored) ? $stored : array();
}

function maat_wl_write($leads) {
    if (count($leads) > 1000) {
        $leads = array_slice($leads, -1000);
    }
    update_option(MAAT_WL_OPTION, array_values($leads), false);
}

function maat_wl_remember($lead) {
    if (!is_array($lead) || empty($lead['externalId'])) {
        return false;
    }
    $leads = maat_wl_read();
    foreach ($leads as $item) {
        if (is_array($item) && isset($item['externalId']) && $item['externalId'] === $lead['externalId']) {
            return false;
        }
    }
    $leads[] = $lead;
    maat_wl_write($leads);
    return true;
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
        maat_wl_remember($lead);
    }
}

function maat_wl_import_existing() {
    if (get_option(MAAT_WL_IMPORTED)) {
        return;
    }
    global $wpdb;
    $table = $wpdb->prefix . 'fluentform_submissions';
    $found = $wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $wpdb->esc_like($table)));
    if ($found !== $table) {
        return;
    }
    $rows = $wpdb->get_results(
        $wpdb->prepare("SELECT id, response, created_at FROM {$table} WHERE form_id = %d ORDER BY id ASC LIMIT 1000", 3),
        ARRAY_A
    );
    if (!is_array($rows)) {
        return;
    }
    foreach ($rows as $row) {
        $lead = maat_wl_lead_from_response($row['id'], $row['response'], $row['created_at']);
        if ($lead) {
            maat_wl_remember($lead);
        }
    }
    update_option(MAAT_WL_IMPORTED, '1', false);
}

add_action('fluentform/submission_inserted', 'maat_wl_store_submission', 10, 3);
add_action('fluentform_submission_inserted', 'maat_wl_store_submission', 10, 3);
add_action('admin_init', 'maat_wl_import_existing');

add_action('rest_api_init', function () {
    register_rest_route('maat/v1', '/wholesale-leads', array(
        'methods' => 'GET',
        'permission_callback' => '__return_true',
        'callback' => function () {
            maat_wl_import_existing();
            return array(
                'schemaVersion' => 1,
                'connected' => true,
                'leads' => maat_wl_read(),
            );
        },
    ));
});

add_filter('rest_pre_serve_request', function ($served, $result, $request) {
    if ($request instanceof WP_REST_Request && $request->get_route() === '/maat/v1/wholesale-leads') {
        header('Access-Control-Allow-Origin: *');
    }
    return $served;
}, 10, 3);
