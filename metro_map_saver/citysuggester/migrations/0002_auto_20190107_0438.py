# -*- coding: utf-8 -*-
# Generated by Django 1.11.17 on 2019-01-07 04:38
from __future__ import unicode_literals

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('citysuggester', '0001_initial'),
    ]

    operations = [
        migrations.AlterField(
            model_name='travelsystem',
            name='name',
            field=models.CharField(max_length=255, unique=True),
        ),
    ]
