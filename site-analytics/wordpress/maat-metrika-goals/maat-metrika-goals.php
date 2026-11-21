<?php
/**
 * Plugin Name: MAAT Metrika Goals
 * Description: Цели прайса и контактов для уже установленного счётчика Яндекс Метрики 99820405. Счётчик, Site Kit, Jetpack и Вебвизор не меняет.
 * Version: 1.0.1
 * Author: MA Distribution
 * Requires at least: 6.0
 * Requires PHP: 7.4
 */

if (!defined('ABSPATH')) {
    exit;
}

/**
 * Fluent Forms 6.2.7 (form-submission.js на maat-impera.ru) считает отправку
 * успешной только когда в ответе есть data.result. Тогда плагин шлёт
 * jQuery-событие и CustomEvent fluentform_submission_success.
 * Ошибки валидации и сбой запроса дают fluentform_submission_failed — их не слушаем.
 * Кнопка формы называется «Скачать прайс», но это отправка, не выдача файла.
 * Файл лежит ссылкой на /price_download/, поэтому фиксируется клик price_download_click.
 */
add_action('wp_enqueue_scripts', function () {
    if (is_admin()) {
        return;
    }

    wp_register_script(
        'maat-metrika-goals',
        plugins_url('assets/goals.js', __FILE__),
        array('jquery'),
        '1.0.1',
        true
    );

    wp_add_inline_script(
        'maat-metrika-goals',
        'window.MAAT_METRIKA = ' . wp_json_encode(array(
            'counterId' => 99820405,
            'formId' => 3,
            'auto' => true,
        )) . ';',
        'before'
    );

    wp_enqueue_script('maat-metrika-goals');
});
