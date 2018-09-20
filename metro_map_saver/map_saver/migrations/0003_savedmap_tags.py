# -*- coding: utf-8 -*-
# Generated by Django 1.11.4 on 2018-07-24 00:56
from __future__ import unicode_literals

from django.db import migrations
import taggit.managers


class Migration(migrations.Migration):

    dependencies = [
        ('taggit', '0002_auto_20150616_2121'),
        ('map_saver', '0002_savedmap_gallery_visible'),
    ]

    operations = [
        migrations.AddField(
            model_name='savedmap',
            name='tags',
            field=taggit.managers.TaggableManager(blank=True, help_text='A comma-separated list of tags.', through='taggit.TaggedItem', to='taggit.Tag', verbose_name='Tags'),
        ),
    ]